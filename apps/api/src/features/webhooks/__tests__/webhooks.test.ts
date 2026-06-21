import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import crypto from 'crypto';
import dns from 'dns';
import { WebhooksService } from '../webhooks.service';
import type { WebhooksRepository } from '../webhooks.types';
import { isPrivateIp, validateWebhookUrl } from '../webhook.validator';
import { encryptGcm } from '../../../lib/crypto';
import { NotFoundError, ValidationError } from '../../../lib/errors';
import { processWebhookDelivery } from '../../../workers/webhook.worker';

// 1. Mock Queue Connection & configuration
const mockQueueAdd = vi.fn();
vi.mock('../../../config/queue', () => ({
  getWebhooksQueue: () => ({
    add: mockQueueAdd,
  }),
}));

// 2. Mock Audit Logs Service
const mockAuditRecord = vi.fn().mockResolvedValue(undefined);
const mockAuditLogsService = {
  record: mockAuditRecord,
} as any;

// 3. Mock DNS lookup
vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: vi.fn().mockImplementation(async (hostname: string) => {
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return [{ address: '127.0.0.1', family: 4 }];
        }
        if (hostname === 'private.com') {
          return [{ address: '10.0.0.1', family: 4 }];
        }
        if (hostname === 'google.com') {
          return [{ address: '8.8.8.8', family: 4 }];
        }
        return [{ address: '93.184.216.34', family: 4 }]; // example.com
      }),
    },
  },
}));

// 4. Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// 5. Mock Mongoose Models
const mockWebhookFindById = vi.fn();
const mockWebhookFindByIdAndUpdate = vi.fn();
const mockDeliveryFindById = vi.fn();
const mockDeliveryFindByIdAndUpdate = vi.fn();

vi.mock('../../../infrastructure/database/models/webhook.model', () => ({
  WebhookModel: {
    findById: (id: any) => ({
      exec: async () => mockWebhookFindById(id),
    }),
    findByIdAndUpdate: (id: any, update: any, options?: any) => ({
      exec: async () => {
        if (options !== undefined) {
          return mockWebhookFindByIdAndUpdate(id, update, options);
        }
        return mockWebhookFindByIdAndUpdate(id, update);
      },
    }),
  },
}));

vi.mock('../../../infrastructure/database/models/webhook-delivery.model', () => ({
  WebhookDeliveryModel: {
    findById: (id: any) => ({
      exec: async () => mockDeliveryFindById(id),
    }),
    findByIdAndUpdate: (id: any, update: any, options?: any) => ({
      exec: async () => {
        if (options !== undefined) {
          return mockDeliveryFindByIdAndUpdate(id, update, options);
        }
        return mockDeliveryFindByIdAndUpdate(id, update);
      },
    }),
  },
}));

// 6. Helpers to build Mock Mongoose documents
function createMockWebhookDoc(data: any) {
  const doc = {
    _id: data._id || data.id || 'wh-123',
    id: data.id || 'wh-123',
    organizationId: data.organizationId || 'org-123',
    projectId: data.projectId || null,
    name: data.name || 'Test Webhook',
    url: data.url || 'https://example.com/webhook',
    events: data.events || ['deployment.completed'],
    secretCiphertext: data.secretCiphertext || 'cipher',
    secretIv: data.secretIv || 'iv',
    secretAuthTag: data.secretAuthTag || 'tag',
    previousSecretCiphertext: data.previousSecretCiphertext || null,
    previousSecretIv: data.previousSecretIv || null,
    previousSecretAuthTag: data.previousSecretAuthTag || null,
    previousSecretExpiresAt: data.previousSecretExpiresAt || null,
    isActive: data.isActive !== undefined ? data.isActive : true,
    failureStreak: data.failureStreak || 0,
    disabledAt: data.disabledAt || null,
    lastDeliveryAt: data.lastDeliveryAt || null,
    lastDeliveryStatus: data.lastDeliveryStatus || null,
    save: async function () {
      return this;
    },
    toJSON: function () {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        projectId: this.projectId ? this.projectId.toString() : null,
        name: this.name,
        url: this.url,
        events: this.events,
        isActive: this.isActive,
        disabledAt: this.disabledAt ? this.disabledAt.toISOString() : null,
        lastDeliveryAt: this.lastDeliveryAt ? this.lastDeliveryAt.toISOString() : null,
        lastDeliveryStatus: this.lastDeliveryStatus,
      };
    },
  };
  return doc as any;
}

function createMockDeliveryDoc(data: any) {
  const doc = {
    _id: data._id || data.id || 'del-123',
    id: data.id || 'del-123',
    webhookId: data.webhookId || 'wh-123',
    organizationId: data.organizationId || 'org-123',
    eventId: data.eventId || 'evt-123',
    eventType: data.eventType || 'deployment.completed',
    payload: data.payload || {},
    statusCode: data.statusCode || null,
    responseTime: data.responseTime || null,
    attempt: data.attempt || 1,
    error: data.error || null,
    status: data.status || 'pending',
    attempts: data.attempts || [],
    createdAt: data.createdAt || new Date(),
    expiresAt: data.expiresAt || new Date(),
    save: async function () {
      return this;
    },
    toJSON: function () {
      return {
        id: this.id,
        webhookId: this.webhookId.toString(),
        organizationId: this.organizationId.toString(),
        eventId: this.eventId,
        eventType: this.eventType,
        payload: this.payload,
        statusCode: this.statusCode,
        responseTime: this.responseTime,
        attempt: this.attempt,
        error: this.error,
        status: this.status,
        attempts: this.attempts,
        createdAt: this.createdAt.toISOString(),
      };
    },
  };
  return doc as any;
}

// 7. In-Memory Webhooks Repository implementation for testing service layer
class InMemoryWebhooksRepository implements WebhooksRepository {
  public webhooks: any[] = [];
  public deliveries: any[] = [];

  async findWebhookById(id: string): Promise<any | null> {
    return this.webhooks.find((w) => w.id === id) || null;
  }

  async findWebhooksByOrg(orgId: string, filters?: any): Promise<any[]> {
    return this.webhooks.filter((w) => {
      if (w.organizationId !== orgId) return false;
      if (filters?.projectId && w.projectId !== filters.projectId) return false;
      return true;
    });
  }

  async findActiveWebhooksForEvent(orgId: string, eventType: string, projectId?: string | null): Promise<any[]> {
    return this.webhooks.filter((w) => {
      if (w.organizationId !== orgId) return false;
      if (!w.isActive) return false;
      if (projectId && w.projectId && w.projectId !== projectId) return false;
      return w.events.includes(eventType);
    });
  }

  async createWebhook(orgId: string, createdBy: string, data: any): Promise<any> {
    const webhook = createMockWebhookDoc({
      ...data,
      id: `wh-${this.webhooks.length + 1}`,
      organizationId: orgId,
      createdBy,
    });
    this.webhooks.push(webhook);
    return webhook;
  }

  async updateWebhook(id: string, update: Partial<any>): Promise<any | null> {
    const webhook = await this.findWebhookById(id);
    if (!webhook) return null;
    Object.assign(webhook, update);
    return webhook;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    const len = this.webhooks.length;
    this.webhooks = this.webhooks.filter((w) => w.id !== id);
    return this.webhooks.length < len;
  }

  async findDeliveryById(id: string): Promise<any | null> {
    return this.deliveries.find((d) => d.id === id) || null;
  }

  async findDeliveriesByWebhook(
    webhookId: string,
    limit: number,
    cursor?: string,
    filters?: any
  ): Promise<any> {
    let filtered = this.deliveries.filter((d) => d.webhookId === webhookId);
    if (filters?.status) {
      filtered = filtered.filter((d) => d.status === filters.status);
    }
    if (filters?.eventType) {
      filtered = filtered.filter((d) => d.eventType === filters.eventType);
    }

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let startIndex = 0;
    if (cursor) {
      startIndex = filtered.findIndex((d) => d.id === cursor) + 1;
    }

    const items = filtered.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < filtered.length;
    const nextCursor = hasNext ? items[items.length - 1].id : null;

    return {
      deliveries: items,
      hasNext,
      nextCursor,
    };
  }

  async createDelivery(data: any): Promise<any> {
    const delivery = createMockDeliveryDoc({
      ...data,
      id: data._id ? data._id.toString() : `del-${this.deliveries.length + 1}`,
    });
    this.deliveries.push(delivery);
    return delivery;
  }

  async updateDelivery(id: string, update: Partial<any>): Promise<any | null> {
    const delivery = await this.findDeliveryById(id);
    if (!delivery) return null;
    Object.assign(delivery, update);
    return delivery;
  }
}

describe('Webhooks module', () => {
  let webhookRepo: InMemoryWebhooksRepository;
  let service: WebhooksService;
  const orgId = '60d5ec386f6e520015b67d5e';
  const userId = '60d5ec386f6e520015b67d5f';

  beforeEach(() => {
    vi.clearAllMocks();
    webhookRepo = new InMemoryWebhooksRepository();
    service = new WebhooksService(webhookRepo, mockAuditLogsService);
  });

  describe('SSRF Protection Validator', () => {
    it('should correctly detect private IP addresses', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('localhost')).toBe(true);
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('172.16.0.2')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      expect(isPrivateIp('192.168.1.100')).toBe(true);
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('fc00::1')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);

      // Public IPs
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('1.1.1.1')).toBe(false);
      expect(isPrivateIp('172.15.0.1')).toBe(false); // Outside private range
      expect(isPrivateIp('172.32.0.1')).toBe(false); // Outside private range
      expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
    });

    it('should validate valid public HTTPS URLs', async () => {
      await expect(validateWebhookUrl('https://google.com/webhook')).resolves.not.toThrow();
    });

    it('should throw ValidationError for HTTP protocol', async () => {
      await expect(validateWebhookUrl('http://example.com/webhook')).rejects.toThrow(
        'Webhook URL must use HTTPS'
      );
    });

    it('should throw ValidationError for local hostname loopback / private IP', async () => {
      await expect(validateWebhookUrl('https://localhost/webhook')).rejects.toThrow(
        'Webhook URL resolves to a blocked IP address'
      );
      await expect(validateWebhookUrl('https://private.com/webhook')).rejects.toThrow(
        'Webhook URL resolves to a blocked IP address'
      );
    });
  });

  describe('WebhooksService CRUD', () => {
    it('should create a webhook with generated secret', async () => {
      const result = await service.createWebhook(orgId, userId, {
        name: 'My Webhook',
        url: 'https://google.com/webhook',
        events: ['deployment.completed', 'secret.created'],
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('My Webhook');
      expect(result.url).toBe('https://google.com/webhook');
      expect(result.isActive).toBe(true);
      expect(result.secret).toMatch(/^whsec_/);
      expect(webhookRepo.webhooks).toHaveLength(1);
      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook.created',
          organizationId: orgId,
        })
      );
    });

    it('should throw error on create with invalid URL protocol or private IP', async () => {
      await expect(
        service.createWebhook(orgId, userId, {
          name: 'Invalid',
          url: 'http://example.com',
          events: ['secret.created'],
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        service.createWebhook(orgId, userId, {
          name: 'Private',
          url: 'https://localhost/webhook',
          events: ['secret.created'],
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should get a webhook by ID and verify org ID', async () => {
      const created = await service.createWebhook(orgId, userId, {
        name: 'Web 1',
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
      });

      const fetched = await service.getWebhook(orgId, created.id);
      expect(fetched.name).toBe('Web 1');

      await expect(service.getWebhook('different-org', created.id)).rejects.toThrow(NotFoundError);
    });

    it('should list webhooks in org and respect project filter', async () => {
      await webhookRepo.createWebhook(orgId, userId, {
        name: 'Wh 1',
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
        projectId: 'project-A',
      });
      await webhookRepo.createWebhook(orgId, userId, {
        name: 'Wh 2',
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
        projectId: null,
      });

      const listAll = await service.listWebhooks(orgId);
      expect(listAll).toHaveLength(2);

      const listProj = await service.listWebhooks(orgId, { projectId: 'project-A' });
      expect(listProj).toHaveLength(1);
      expect(listProj[0]!.name).toBe('Wh 1');
    });

    it('should update webhook url and other metadata', async () => {
      const created = await service.createWebhook(orgId, userId, {
        name: 'Old Name',
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
      });

      // Update name and active status
      const updated = await service.updateWebhook(orgId, created.id, userId, {
        name: 'New Name',
        isActive: false,
      });

      expect(updated.name).toBe('New Name');
      expect(updated.isActive).toBe(false);
      expect(updated.disabledAt).toBeInstanceOf(Date);

      // Reactive and verify streak reset
      webhookRepo.webhooks[0].failureStreak = 50;
      const reactivated = await service.updateWebhook(orgId, created.id, userId, {
        isActive: true,
      });
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.failureStreak).toBe(0);
      expect(reactivated.disabledAt).toBeNull();
    });

    it('should rotate secret with grace period', async () => {
      const created = await service.createWebhook(orgId, userId, {
        name: 'Rotate Webhook',
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
      });

      const dbWebhook = webhookRepo.webhooks[0];
      const initialCipher = dbWebhook.secretCiphertext;

      const newSecret = await service.rotateSecret(orgId, created.id, userId);
      expect(newSecret).toMatch(/^whsec_/);
      expect(dbWebhook.secretCiphertext).not.toBe(initialCipher);
      expect(dbWebhook.previousSecretCiphertext).toBe(initialCipher);
      expect(dbWebhook.previousSecretExpiresAt).toBeInstanceOf(Date);
      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook.secret_rotated',
        })
      );
    });

    it('should test a webhook by queuing a test event', async () => {
      const created = await service.createWebhook(orgId, userId, {
        name: 'Test Webhook',
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
      });

      const deliveryId = await service.testWebhook(orgId, created.id, userId);
      expect(deliveryId).toBeDefined();

      expect(webhookRepo.deliveries).toHaveLength(1);
      expect(webhookRepo.deliveries[0].status).toBe('pending');
      expect(webhookRepo.deliveries[0].eventType).toBe('webhook.test');
      expect(mockQueueAdd).toHaveBeenCalled();
      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook.tested',
        })
      );
    });
  });

  describe('Webhook worker (processWebhookDelivery)', () => {
    const testSecret = 'whsec_my_test_webhook_secret_key_123';
    let webhookDoc: any;
    let deliveryDoc: any;

    beforeEach(() => {
      const encrypted = encryptGcm(testSecret, orgId);
      webhookDoc = createMockWebhookDoc({
        id: 'wh-999',
        organizationId: orgId,
        url: 'https://google.com/webhook',
        events: ['deployment.completed'],
        secretCiphertext: encrypted.ciphertext,
        secretIv: encrypted.iv,
        secretAuthTag: encrypted.authTag,
      });

      deliveryDoc = createMockDeliveryDoc({
        id: 'del-999',
        webhookId: 'wh-999',
        organizationId: orgId,
        eventId: 'evt-999',
        eventType: 'deployment.completed',
        payload: {
          id: 'evt-999',
          event: 'deployment.completed',
          data: { foo: 'bar' },
        },
      });

      mockWebhookFindById.mockResolvedValue(webhookDoc);
      mockWebhookFindByIdAndUpdate.mockResolvedValue(webhookDoc);
      mockDeliveryFindById.mockResolvedValue(deliveryDoc);
      mockDeliveryFindByIdAndUpdate.mockResolvedValue(deliveryDoc);
    });

    it('should deliver webhook successfully, sign payload and reset failure streak', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'Received',
      });

      const mockJob = {
        data: {
          webhookId: 'wh-999',
          deliveryId: 'del-999',
          orgId,
          event: 'deployment.completed',
          payload: deliveryDoc.payload,
        },
        attemptsMade: 0,
      } as any;

      await processWebhookDelivery(mockJob);

      // Verify fetch call and headers
      expect(mockFetch).toHaveBeenCalledWith(
        'https://google.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-SELADEV-Event': 'deployment.completed',
            'X-SELADEV-Delivery': 'evt-999',
            'User-Agent': 'SELADEV-Webhook/1.0',
          }),
        })
      );

      const fetchArgs = (mockFetch as Mock).mock.calls[0];
      expect(fetchArgs).toBeDefined();
      const headers = fetchArgs![1].headers;
      const signatureHeader = headers['X-SELADEV-Signature'];
      const timestampHeader = headers['X-SELADEV-Timestamp'];

      expect(signatureHeader).toBeDefined();
      expect(signatureHeader.startsWith('sha256=')).toBe(true);

      // Verify signature manually
      const expectedContent = `${timestampHeader}.${JSON.stringify(deliveryDoc.payload)}`;
      const expectedSig = `sha256=${crypto
        .createHmac('sha256', testSecret)
        .update(expectedContent, 'utf8')
        .digest('hex')}`;
      expect(signatureHeader).toBe(expectedSig);

      // Verify db updates
      expect(mockDeliveryFindByIdAndUpdate).toHaveBeenCalledWith(
        'del-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'delivered',
            statusCode: 200,
          }),
        })
      );

      expect(mockWebhookFindByIdAndUpdate).toHaveBeenCalledWith(
        'wh-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            failureStreak: 0,
            lastDeliveryStatus: 'delivered',
          }),
        })
      );
    });

    it('should fail delivery, increment streak and throw on temporary HTTP failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Error',
      });

      const mockJob = {
        data: {
          webhookId: 'wh-999',
          deliveryId: 'del-999',
          orgId,
          event: 'deployment.completed',
          payload: deliveryDoc.payload,
        },
        attemptsMade: 0,
      } as any;

      await expect(processWebhookDelivery(mockJob)).rejects.toThrow('HTTP error: 500');

      expect(mockDeliveryFindByIdAndUpdate).toHaveBeenCalledWith(
        'del-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'failed',
            statusCode: 500,
          }),
        })
      );

      expect(mockWebhookFindByIdAndUpdate).toHaveBeenCalledWith(
        'wh-999',
        expect.objectContaining({
          $inc: expect.objectContaining({ failureStreak: 1 }),
          $set: expect.objectContaining({
            lastDeliveryStatus: 'failed',
          }),
        }),
        expect.objectContaining({ new: true })
      );
    });

    it('should permanently fail and disable immediately on 410 Gone', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 410,
        statusText: 'Gone',
        text: async () => 'Gone',
      });

      const mockJob = {
        data: {
          webhookId: 'wh-999',
          deliveryId: 'del-999',
          orgId,
          event: 'deployment.completed',
          payload: deliveryDoc.payload,
        },
        attemptsMade: 0,
      } as any;

      // Should NOT throw (so BullMQ doesn't retry)
      await expect(processWebhookDelivery(mockJob)).resolves.not.toThrow();

      // Should set status to failed (or dead_letter)
      expect(mockDeliveryFindByIdAndUpdate).toHaveBeenCalledWith(
        'del-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'failed',
            statusCode: 410,
          }),
        })
      );

      // Should disable webhook immediately
      expect(mockWebhookFindByIdAndUpdate).toHaveBeenCalledWith(
        'wh-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            isActive: false,
            disabledAt: expect.any(Date),
          }),
        })
      );
    });

    it('should auto-disable webhook when failure streak reaches 100', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Error',
        text: async () => 'Server error',
      });

      // Mock webhook returning failureStreak >= 99 after increment
      const webhookWithHighStreak = {
        ...webhookDoc,
        failureStreak: 100,
      };
      mockWebhookFindByIdAndUpdate.mockResolvedValue(webhookWithHighStreak);

      const mockJob = {
        data: {
          webhookId: 'wh-999',
          deliveryId: 'del-999',
          orgId,
          event: 'deployment.completed',
          payload: deliveryDoc.payload,
        },
        attemptsMade: 0,
      } as any;

      await expect(processWebhookDelivery(mockJob)).resolves.not.toThrow();

      // Check that webhook was disabled
      expect(mockWebhookFindByIdAndUpdate).toHaveBeenCalledWith(
        'wh-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            isActive: false,
            disabledAt: expect.any(Date),
          }),
        })
      );
    });

    it('should throw on SSRF blocked IP check at worker run time', async () => {
      // Mock lookup to resolve to private IP range
      const dnsLookupSpy = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '192.168.1.5', family: 4 }] as any);

      const mockJob = {
        data: {
          webhookId: 'wh-999',
          deliveryId: 'del-999',
          orgId,
          event: 'deployment.completed',
          payload: deliveryDoc.payload,
        },
        attemptsMade: 0,
      } as any;

      await expect(processWebhookDelivery(mockJob)).rejects.toThrow('SSRF Protection');

      expect(mockDeliveryFindByIdAndUpdate).toHaveBeenCalledWith(
        'del-999',
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'failed',
            statusCode: 400,
            error: expect.stringContaining('SSRF Protection'),
          }),
        })
      );

      dnsLookupSpy.mockRestore();
    });
  });
});
