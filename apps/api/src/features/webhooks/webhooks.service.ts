import crypto from 'crypto';
import type { WebhooksRepository, WebhooksFilters, WebhookDeliveriesFilters } from './webhooks.types';
import type { WebhookDocument } from '../../infrastructure/database/models/webhook.model';
import type { WebhookDeliveryDocument } from '../../infrastructure/database/models/webhook-delivery.model';
import { validateWebhookUrl } from './webhook.validator';
import { encryptGcm } from '../../lib/crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotFoundError } from '../../lib/errors';
import type { CreateWebhookDto, UpdateWebhookDto } from '@seladev/validators';
import { getWebhooksQueue } from '../../config/queue';
import mongoose from 'mongoose';

export class WebhooksService {
  constructor(
    private readonly webhooksRepo: WebhooksRepository,
    private readonly auditLogsService: AuditLogsService
  ) {}

  async createWebhook(
    orgId: string,
    userId: string,
    dto: CreateWebhookDto
  ): Promise<WebhookDocument & { secret: string }> {
    // 1. Validate target URL (SSRF check)
    await validateWebhookUrl(dto.url);

    // 2. Generate random 32-byte secret (prefixed with whsec_)
    const randomBytes = crypto.randomBytes(24).toString('base64url');
    const secret = `whsec_${randomBytes}`;

    // 3. Encrypt secret using AES-256-GCM scoped to orgId
    const encrypted = encryptGcm(secret, orgId);

    // 4. Save to database
    const webhook = await this.webhooksRepo.createWebhook(orgId, userId, {
      ...dto,
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
    });

    // 5. Record Audit Log
    await this.auditLogsService.record({
      organizationId: orgId,
      projectId: dto.projectId || null,
      actor: {
        userId,
        ipAddress: null,
        userAgent: 'system',
      },
      action: 'webhook.created',
      resource: { type: 'webhook', id: webhook.id, name: webhook.name },
      outcome: 'success',
      metadata: {
        url: webhook.url,
        events: webhook.events,
      },
    }).catch(err => console.error('Failed to log audit:', err));

    // Return document with unencrypted secret (only shown on create)
    const resultObj = webhook.toJSON() as any;
    resultObj.secret = secret;
    return resultObj;
  }

  async getWebhook(orgId: string, webhookId: string): Promise<WebhookDocument> {
    const webhook = await this.webhooksRepo.findWebhookById(webhookId);
    if (!webhook || webhook.organizationId.toString() !== orgId) {
      throw new NotFoundError('Webhook not found');
    }
    return webhook;
  }

  async listWebhooks(orgId: string, filters?: WebhooksFilters): Promise<WebhookDocument[]> {
    return this.webhooksRepo.findWebhooksByOrg(orgId, filters);
  }

  async updateWebhook(
    orgId: string,
    webhookId: string,
    userId: string,
    dto: UpdateWebhookDto
  ): Promise<WebhookDocument> {
    const webhook = await this.getWebhook(orgId, webhookId);

    const updateData: Partial<WebhookDocument> = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.events !== undefined) updateData.events = dto.events;
    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
      if (dto.isActive) {
        // Reset streak when reactivating manually
        updateData.failureStreak = 0;
        updateData.disabledAt = null;
      } else {
        updateData.disabledAt = new Date();
      }
    }

    if (dto.url !== undefined && dto.url !== webhook.url) {
      await validateWebhookUrl(dto.url);
      updateData.url = dto.url;
    }

    const updated = await this.webhooksRepo.updateWebhook(webhookId, updateData);
    if (!updated) {
      throw new NotFoundError('Webhook not found during update');
    }

    // Record Audit Log
    await this.auditLogsService.record({
      organizationId: orgId,
      projectId: updated.projectId ? updated.projectId.toString() : null,
      actor: {
        userId,
        ipAddress: null,
        userAgent: 'system',
      },
      action: 'webhook.updated',
      resource: { type: 'webhook', id: updated.id, name: updated.name },
      outcome: 'success',
      metadata: dto,
    }).catch(err => console.error('Failed to log audit:', err));

    return updated;
  }

  async deleteWebhook(orgId: string, webhookId: string, userId: string): Promise<void> {
    const webhook = await this.getWebhook(orgId, webhookId);
    const deleted = await this.webhooksRepo.deleteWebhook(webhookId);
    if (!deleted) {
      throw new NotFoundError('Webhook not found during deletion');
    }

    // Record Audit Log
    await this.auditLogsService.record({
      organizationId: orgId,
      projectId: webhook.projectId ? webhook.projectId.toString() : null,
      actor: {
        userId,
        ipAddress: null,
        userAgent: 'system',
      },
      action: 'webhook.deleted',
      resource: { type: 'webhook', id: webhook.id, name: webhook.name },
      outcome: 'success',
      metadata: { url: webhook.url },
    }).catch(err => console.error('Failed to log audit:', err));
  }

  async rotateSecret(orgId: string, webhookId: string, userId: string): Promise<string> {
    const webhook = await this.getWebhook(orgId, webhookId);

    // 1. Generate new secret
    const randomBytes = crypto.randomBytes(24).toString('base64url');
    const newSecret = `whsec_${randomBytes}`;
    const encrypted = encryptGcm(newSecret, orgId);

    // 2. Set previous secret with 10-minute grace period
    const gracePeriodMinutes = 10;
    const previousSecretExpiresAt = new Date();
    previousSecretExpiresAt.setMinutes(previousSecretExpiresAt.getMinutes() + gracePeriodMinutes);

    const updateData: Partial<WebhookDocument> = {
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      previousSecretCiphertext: webhook.secretCiphertext,
      previousSecretIv: webhook.secretIv,
      previousSecretAuthTag: webhook.secretAuthTag,
      previousSecretExpiresAt,
    };

    await this.webhooksRepo.updateWebhook(webhookId, updateData);

    // 3. Record Audit Log
    await this.auditLogsService.record({
      organizationId: orgId,
      projectId: webhook.projectId ? webhook.projectId.toString() : null,
      actor: {
        userId,
        ipAddress: null,
        userAgent: 'system',
      },
      action: 'webhook.secret_rotated',
      resource: { type: 'webhook', id: webhook.id, name: webhook.name },
      outcome: 'success',
    }).catch(err => console.error('Failed to log audit:', err));

    return newSecret;
  }

  async testWebhook(orgId: string, webhookId: string, userId: string): Promise<string> {
    const webhook = await this.getWebhook(orgId, webhookId);

    // 1. Create a synthetic test payload
    const deliveryId = new mongoose.Types.ObjectId();
    const eventId = `evt_${deliveryId.toString()}`;
    const payload = {
      id: eventId,
      event: 'webhook.test',
      apiVersion: '2026-06-01',
      orgId,
      projectId: webhook.projectId ? webhook.projectId.toString() : null,
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test delivery from SELADEV.',
        webhookId: webhook.id,
        webhookName: webhook.name,
      },
    };

    // 2. Create pending delivery log
    const delivery = await this.webhooksRepo.createDelivery({
      _id: deliveryId,
      webhookId: webhook._id,
      organizationId: new mongoose.Types.ObjectId(orgId),
      eventId,
      eventType: 'webhook.test',
      payload,
      status: 'pending',
      attempt: 1,
      attempts: [],
    });

    // 3. Enqueue delivery job to BullMQ queue specifically targeting this webhook
    const queue = getWebhooksQueue();
    await queue.add(
      'deliver',
      {
        webhookId: webhook.id,
        deliveryId: delivery.id,
        orgId,
        event: 'webhook.test',
        payload,
      },
      {
        jobId: `webhook-test:${webhook.id}:${delivery.id}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    // 4. Record Audit Log
    await this.auditLogsService.record({
      organizationId: orgId,
      projectId: webhook.projectId ? webhook.projectId.toString() : null,
      actor: {
        userId,
        ipAddress: null,
        userAgent: 'system',
      },
      action: 'webhook.tested',
      resource: { type: 'webhook', id: webhook.id, name: webhook.name },
      outcome: 'success',
    }).catch(err => console.error('Failed to log audit:', err));

    return delivery.id;
  }

  // Deliveries logs listing
  async listDeliveries(
    orgId: string,
    webhookId: string,
    limit: number,
    cursor?: string,
    filters?: WebhookDeliveriesFilters
  ): Promise<{ deliveries: WebhookDeliveryDocument[]; hasNext: boolean; nextCursor: string | null }> {
    // Verify ownership of the webhook
    await this.getWebhook(orgId, webhookId);
    return this.webhooksRepo.findDeliveriesByWebhook(webhookId, limit, cursor, filters);
  }

  async getDelivery(orgId: string, webhookId: string, deliveryId: string): Promise<WebhookDeliveryDocument> {
    await this.getWebhook(orgId, webhookId);
    const delivery = await this.webhooksRepo.findDeliveryById(deliveryId);
    if (!delivery || delivery.webhookId.toString() !== webhookId) {
      throw new NotFoundError('Delivery log not found');
    }
    return delivery;
  }
}
