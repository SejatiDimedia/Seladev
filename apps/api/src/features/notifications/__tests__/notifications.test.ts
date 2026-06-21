import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationsService } from '../notifications.service';
import { NotificationsController } from '../notifications.controller';
import type { NotificationsRepository } from '../notifications.repository';
import mongoose from 'mongoose';
import type { Request, Response } from 'express';

// Valid 24-character hex strings for MongoDB ObjectIds
const mockUserId = '60d21b4667d0d8992c616c21';
const mockOrgId = '60d21b4667d0d8992c616c22';
const mockProjectId = '60d21b4667d0d8992c616c23';
const mockEnvId = '60d21b4667d0d8992c616c24';

// 1. Mock Queue and Socket IO Configuration
const mockQueueAdd = vi.fn();
vi.mock('../../../config/queue', () => ({
  getEmailNotificationsQueue: () => ({
    add: mockQueueAdd,
  }),
}));

const mockSocketEmit = vi.fn();
const mockSocketTo = vi.fn().mockImplementation(() => ({
  emit: (...args: any[]) => mockSocketEmit(...args),
}));

vi.mock('../../../config/socket', () => ({
  getSocketServer: () => ({
    to: (...args: any[]) => mockSocketTo(...args),
  }),
}));

// 2. Mock Mongoose Models
// By default, return a valid user with standard preferences to prevent uncaught exceptions.
const mockUserFindById = vi.fn().mockImplementation((id: any) => ({
  id: id.toString(),
  _id: id,
  email: 'user@example.com',
  notificationPreferences: {
    deployment: { inApp: true, email: true },
    secret: { inApp: true, email: true },
    apiKey: { inApp: true, email: true },
    webhook: { inApp: true, email: true },
  },
  save: async function () { return this; },
}));

vi.mock('../../../infrastructure/database/models/user.model', () => ({
  UserModel: {
    findById: (id: any) => ({
      exec: async () => mockUserFindById(id),
    }),
  },
}));

// By default return empty arrays to make them iterable
const mockSecretFind = vi.fn().mockResolvedValue([]);
vi.mock('../../../infrastructure/database/models/secret.model', () => ({
  SecretModel: {
    find: (query: any) => ({
      exec: async () => mockSecretFind(query),
    }),
  },
}));

const mockProjectMemberFind = vi.fn().mockResolvedValue([]);
vi.mock('../../../infrastructure/database/models/project-member.model', () => ({
  ProjectMemberModel: {
    find: (query: any) => ({
      exec: async () => mockProjectMemberFind(query),
    }),
  },
}));

const mockProjectFindById = vi.fn();
vi.mock('../../../infrastructure/database/models/project.model', () => ({
  ProjectModel: {
    findById: (id: any) => ({
      exec: async () => mockProjectFindById(id),
    }),
  },
}));

const mockEnvironmentFindById = vi.fn();
vi.mock('../../../infrastructure/database/models/environment.model', () => ({
  EnvironmentModel: {
    findById: (id: any) => ({
      exec: async () => mockEnvironmentFindById(id),
    }),
  },
}));

const mockApiKeyFind = vi.fn().mockResolvedValue([]);
vi.mock('../../../infrastructure/database/models/api-key.model', () => ({
  ApiKeyModel: {
    find: (query: any) => ({
      exec: async () => mockApiKeyFind(query),
    }),
  },
}));

const mockMembershipFind = vi.fn().mockResolvedValue([]);
vi.mock('../../../infrastructure/database/models/membership.model', () => ({
  MembershipModel: {
    find: (query: any) => ({
      exec: async () => mockMembershipFind(query),
    }),
  },
}));

// 3. Mock document generator
function createMockNotificationDoc(data: any) {
  return {
    _id: data.id || '60d21b4667d0d8992c616c27',
    id: data.id || '60d21b4667d0d8992c616c27',
    userId: data.userId,
    organizationId: data.organizationId,
    type: data.type,
    title: data.title,
    message: data.message,
    link: data.link || null,
    isRead: data.isRead !== undefined ? data.isRead : false,
    createdAt: data.createdAt || new Date(),
    toJSON: function () {
      return {
        id: this.id,
        userId: this.userId.toString(),
        organizationId: this.organizationId.toString(),
        type: this.type,
        title: this.title,
        message: this.message,
        link: this.link,
        isRead: this.isRead,
        createdAt: this.createdAt.toISOString(),
      };
    },
  };
}

// 4. InMemory Repository implementation
class InMemoryNotificationsRepository implements NotificationsRepository {
  public notifications: any[] = [];

  async create(data: any): Promise<any> {
    const doc = createMockNotificationDoc({
      ...data,
      id: `60d21b4667d0d8992c616c${String(this.notifications.length + 10).padStart(2, '0')}`,
    });
    this.notifications.push(doc);
    return doc;
  }

  async findManyByUser(
    userId: string,
    limit: number,
    _cursor?: string | null
  ): Promise<{ notifications: any[]; hasNext: boolean; nextCursor: string | null }> {
    const list = this.notifications.filter(n => n.userId.toString() === userId.toString());
    return {
      notifications: list.slice(0, limit),
      hasNext: list.length > limit,
      nextCursor: null,
    };
  }

  async markAsRead(notificationId: string, userId: string): Promise<any | null> {
    const item = this.notifications.find(
      n => n.id === notificationId && n.userId.toString() === userId.toString()
    );
    if (!item) return null;
    item.isRead = true;
    return item;
  }

  async markAllAsRead(userId: string): Promise<void> {
    this.notifications
      .filter(n => n.userId.toString() === userId.toString())
      .forEach(n => {
        n.isRead = true;
      });
  }

  async countUnread(userId: string): Promise<number> {
    return this.notifications.filter(n => n.userId.toString() === userId.toString() && !n.isRead).length;
  }
}

describe('Notifications Module (Phase 1.8 / Phase 3.8)', () => {
  let repo: InMemoryNotificationsRepository;
  let service: NotificationsService;
  let controller: NotificationsController;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = new InMemoryNotificationsRepository();
    service = new NotificationsService(repo);
    controller = new NotificationsController(service);

    mockQueueAdd.mockClear();
    mockSocketEmit.mockClear();
    mockSocketTo.mockReset().mockImplementation(() => ({
      emit: (...args: any[]) => mockSocketEmit(...args),
    }));
    
    // Reset mocks to their safe default implementations
    mockUserFindById.mockReset().mockImplementation((id: any) => ({
      id: id.toString(),
      _id: id,
      email: 'user@example.com',
      notificationPreferences: {
        deployment: { inApp: true, email: true },
        secret: { inApp: true, email: true },
        apiKey: { inApp: true, email: true },
        webhook: { inApp: true, email: true },
      },
      save: async function () { return this; },
    }));

    mockSecretFind.mockReset().mockResolvedValue([]);
    mockProjectMemberFind.mockReset().mockResolvedValue([]);
    mockProjectFindById.mockReset();
    mockEnvironmentFindById.mockReset();
    mockApiKeyFind.mockReset().mockResolvedValue([]);
    mockMembershipFind.mockReset().mockResolvedValue([]);
  });

  describe('Notifications Preferences', () => {
    it('should return default preferences when user has none set', async () => {
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
        notificationPreferences: undefined,
      };
      mockUserFindById.mockResolvedValue(mockUser);

      const prefs = await service.getPreferences(mockUserId);
      expect(prefs.deployment.inApp).toBe(true);
      expect(prefs.secret.email).toBe(true);
    });

    it('should update preferences correctly', async () => {
      const mockUser = {
        id: mockUserId,
        notificationPreferences: {},
        save: vi.fn().mockResolvedValue(true),
      };
      mockUserFindById.mockResolvedValue(mockUser);

      const newPrefs = {
        deployment: { inApp: false, email: true },
        secret: { inApp: true, email: false },
        apiKey: { inApp: false, email: false },
        webhook: { inApp: true, email: true },
      };

      const updated = await service.updatePreferences(mockUserId, newPrefs);
      expect(updated.deployment.inApp).toBe(false);
      expect(updated.secret.email).toBe(false);
      expect(mockUser.save).toHaveBeenCalled();
    });
  });

  describe('Notification Dispatch & Enforcement', () => {
    it('should create notification in app and queue email if enabled', async () => {
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
        notificationPreferences: {
          deployment: { inApp: true, email: true },
        },
      };
      mockUserFindById.mockResolvedValue(mockUser);

      await service.createNotification(
        mockUserId,
        mockOrgId,
        'deployment.succeeded',
        'Deploy Success',
        'Your deployment succeeded'
      );

      expect(repo.notifications).toHaveLength(1);
      expect(repo.notifications[0].title).toBe('Deploy Success');
      expect(mockQueueAdd).toHaveBeenCalledWith('send-email', expect.any(Object));
      expect(mockSocketTo).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(mockSocketEmit).toHaveBeenCalledWith('notification:received', expect.any(Object));
    });

    it('should honor disabled preferences: inApp = false, email = true', async () => {
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
        notificationPreferences: {
          deployment: { inApp: false, email: true },
        },
      };
      mockUserFindById.mockResolvedValue(mockUser);

      await service.createNotification(
        mockUserId,
        mockOrgId,
        'deployment.succeeded',
        'Deploy Success',
        'Your deployment succeeded'
      );

      expect(repo.notifications).toHaveLength(0); // in-app disabled
      expect(mockQueueAdd).toHaveBeenCalled(); // email enqueued
    });

    it('should honor disabled preferences: inApp = true, email = false', async () => {
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
        notificationPreferences: {
          deployment: { inApp: true, email: false },
        },
      };
      mockUserFindById.mockResolvedValue(mockUser);

      await service.createNotification(
        mockUserId,
        mockOrgId,
        'deployment.succeeded',
        'Deploy Success',
        'Your deployment succeeded'
      );

      expect(repo.notifications).toHaveLength(1); // in-app enabled
      expect(mockQueueAdd).not.toHaveBeenCalled(); // email disabled
    });

    it('should bypass user preferences for critical security events', async () => {
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
        notificationPreferences: {
          deployment: { inApp: false, email: false }, // All disabled
        },
      };
      mockUserFindById.mockResolvedValue(mockUser);

      // Trigger critical security event (e.g. role.changed) which is not in preferences list
      await service.createNotification(
        mockUserId,
        mockOrgId,
        'role.changed',
        'Role Changed',
        'Your role was updated'
      );

      // Should bypass preferences and deliver both
      expect(repo.notifications).toHaveLength(1);
      expect(mockQueueAdd).toHaveBeenCalled();
    });
  });

  describe('Marking Notifications as Read', () => {
    it('should mark a specific notification as read and emit socket event', async () => {
      const mockUser = { id: mockUserId, email: 'user@example.com' };
      mockUserFindById.mockResolvedValue(mockUser);

      const notif = await repo.create({
        userId: mockUserId,
        organizationId: mockOrgId,
        type: 'deployment.succeeded',
        title: 'Title',
        message: 'Message',
        isRead: false,
      });

      const updated = await service.markAsRead(notif.id, mockUserId);
      expect(updated.isRead).toBe(true);
      expect(mockSocketTo).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(mockSocketEmit).toHaveBeenCalledWith('notification:unread_count_updated', { unreadCount: 0 });
    });

    it('should mark all notifications as read', async () => {
      const mockUser = { id: mockUserId, email: 'user@example.com' };
      mockUserFindById.mockResolvedValue(mockUser);

      await repo.create({ userId: mockUserId, organizationId: mockOrgId, type: 'deployment.succeeded', title: 'T1', message: 'M1', isRead: false });
      await repo.create({ userId: mockUserId, organizationId: mockOrgId, type: 'deployment.succeeded', title: 'T2', message: 'M2', isRead: false });

      await service.markAllAsRead(mockUserId);

      expect(repo.notifications[0].isRead).toBe(true);
      expect(repo.notifications[1].isRead).toBe(true);
      expect(mockSocketEmit).toHaveBeenCalledWith('notification:unread_count_updated', { unreadCount: 0 });
    });
  });

  describe('Daily Expiration Checks (checkExpirations)', () => {
    it('should identify expiring secrets and notify project admins', async () => {
      const mockAdminUserId = '60d21b4667d0d8992c616c90';
      const mockUser = { id: mockAdminUserId, email: 'admin@example.com' };
      mockUserFindById.mockResolvedValue(mockUser);

      const mockSecret = {
        key: 'DB_PASSWORD',
        projectId: new mongoose.Types.ObjectId(mockProjectId),
        environmentId: new mongoose.Types.ObjectId(mockEnvId),
        organizationId: new mongoose.Types.ObjectId(mockOrgId),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        expiryNotified: false,
        save: vi.fn(),
      };

      mockSecretFind.mockResolvedValue([mockSecret]);
      mockProjectMemberFind.mockResolvedValue([{ userId: mockAdminUserId, role: 'admin' }]);
      mockProjectFindById.mockResolvedValue({ name: 'Seladev Web' });
      mockEnvironmentFindById.mockResolvedValue({ name: 'Production' });

      await service.checkExpirations();

      expect(repo.notifications).toHaveLength(1);
      expect(repo.notifications[0].title).toBe('Secret Expiring Soon');
      expect(repo.notifications[0].userId.toString()).toBe(mockAdminUserId);
      expect(mockSecret.expiryNotified).toBe(true);
      expect(mockSecret.save).toHaveBeenCalled();
    });

    it('should identify expiring API keys and notify project/org admins', async () => {
      const mockAdminUserId = '60d21b4667d0d8992c616c91';
      const mockUser = { id: mockAdminUserId, email: 'admin2@example.com' };
      mockUserFindById.mockResolvedValue(mockUser);

      const mockApiKey = {
        name: 'CI/CD Token',
        organizationId: new mongoose.Types.ObjectId(mockOrgId),
        projectId: null, // Org-scoped API Key
        expiresAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        expiryNotified: false,
        save: vi.fn(),
      };

      mockApiKeyFind.mockResolvedValue([mockApiKey]);
      mockMembershipFind.mockResolvedValue([{ userId: mockAdminUserId, role: 'admin' }]);

      await service.checkExpirations();

      expect(repo.notifications).toHaveLength(1);
      expect(repo.notifications[0].title).toBe('API Key Expiring Soon');
      expect(repo.notifications[0].userId.toString()).toBe(mockAdminUserId);
      expect(mockApiKey.expiryNotified).toBe(true);
      expect(mockApiKey.save).toHaveBeenCalled();
    });
  });

  describe('NotificationsController', () => {
    it('getUserNotifications should return user notifications', async () => {
      const req = {
        user: { id: mockUserId },
        query: { limit: '10' },
      } as any as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any as Response;

      const next = vi.fn();

      await controller.getUserNotifications(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.any(Object),
      });
    });

    it('getPreferences should return user notification preferences', async () => {
      const mockUser = { id: mockUserId, email: 'user@example.com' };
      mockUserFindById.mockResolvedValue(mockUser);

      const req = {
        user: { id: mockUserId },
      } as any as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any as Response;

      const next = vi.fn();

      await controller.getPreferences(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.any(Object),
      });
    });

    it('updatePreferences should update user preferences', async () => {
      const mockUser = {
        id: mockUserId,
        notificationPreferences: {},
        save: vi.fn().mockResolvedValue(true),
      };
      mockUserFindById.mockResolvedValue(mockUser);

      const req = {
        user: { id: mockUserId },
        body: {
          deployment: { inApp: false, email: true },
          secret: { inApp: true, email: false },
          apiKey: { inApp: false, email: false },
          webhook: { inApp: true, email: true },
        },
      } as any as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any as Response;

      const next = vi.fn();

      await controller.updatePreferences(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.any(Object),
      });
    });
  });
});
