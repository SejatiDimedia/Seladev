import mongoose from 'mongoose';
import { WebhookModel, type WebhookDocument } from '../../infrastructure/database/models/webhook.model';
import { WebhookDeliveryModel, type WebhookDeliveryDocument } from '../../infrastructure/database/models/webhook-delivery.model';
import type { WebhooksRepository, WebhooksFilters, WebhookDeliveriesFilters } from './webhooks.types';
import type { CreateWebhookDto } from '@seladev/validators';

export class MongooseWebhooksRepository implements WebhooksRepository {
  async findWebhookById(id: string): Promise<WebhookDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return WebhookModel.findById(id).exec();
  }

  async findWebhooksByOrg(orgId: string, filters?: WebhooksFilters): Promise<WebhookDocument[]> {
    const query: any = {
      organizationId: new mongoose.Types.ObjectId(orgId),
    };

    if (filters) {
      if (filters.projectId !== undefined) {
        query.projectId = filters.projectId ? new mongoose.Types.ObjectId(filters.projectId) : null;
      }
      if (filters.isActive !== undefined) {
        query.isActive = filters.isActive;
      }
    }

    return WebhookModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async findActiveWebhooksForEvent(orgId: string, eventType: string, projectId?: string | null): Promise<WebhookDocument[]> {
    const query: any = {
      organizationId: new mongoose.Types.ObjectId(orgId),
      isActive: true,
      events: eventType, // MongoDB $in match if events is array of strings containing eventType
    };

    if (projectId) {
      // Return webhooks scoped to this project OR org-level (projectId = null)
      query.$or = [
        { projectId: new mongoose.Types.ObjectId(projectId) },
        { projectId: null }
      ];
    } else {
      // Scoped only to org-level
      query.projectId = null;
    }

    return WebhookModel.find(query).exec();
  }

  async createWebhook(
    orgId: string,
    createdBy: string,
    data: CreateWebhookDto & { secretCiphertext: string; secretIv: string; secretAuthTag: string }
  ): Promise<WebhookDocument> {
    return WebhookModel.create({
      organizationId: new mongoose.Types.ObjectId(orgId),
      projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : null,
      name: data.name,
      url: data.url,
      events: data.events,
      secretCiphertext: data.secretCiphertext,
      secretIv: data.secretIv,
      secretAuthTag: data.secretAuthTag,
      isActive: true,
      failureStreak: 0,
      createdBy: new mongoose.Types.ObjectId(createdBy),
    });
  }

  async updateWebhook(id: string, update: Partial<WebhookDocument>): Promise<WebhookDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return WebhookModel.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
  }

  async deleteWebhook(id: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(id)) return false;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await WebhookModel.findByIdAndDelete(id).session(session).exec();
      if (!result) {
        await session.abortTransaction();
        session.endSession();
        return false;
      }
      // Delete associated deliveries
      await WebhookDeliveryModel.deleteMany({ webhookId: new mongoose.Types.ObjectId(id) }).session(session).exec();
      await session.commitTransaction();
      session.endSession();
      return true;
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  // Deliveries logs
  async findDeliveryById(id: string): Promise<WebhookDeliveryDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return WebhookDeliveryModel.findById(id).exec();
  }

  async findDeliveriesByWebhook(
    webhookId: string,
    limit: number,
    cursor?: string,
    filters?: WebhookDeliveriesFilters
  ): Promise<{ deliveries: WebhookDeliveryDocument[]; hasNext: boolean; nextCursor: string | null }> {
    const query: any = {
      webhookId: new mongoose.Types.ObjectId(webhookId),
    };

    if (filters) {
      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.eventType) {
        query.eventType = filters.eventType;
      }
    }

    // Apply cursor
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        const { id, ts } = decoded;
        if (id && ts) {
          query.$or = [
            { createdAt: { $lt: new Date(ts) } },
            { createdAt: new Date(ts), _id: { $lt: new mongoose.Types.ObjectId(id) } }
          ];
        }
      } catch (err) {
        // ignore invalid cursor
      }
    }

    const deliveries = await WebhookDeliveryModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNext = deliveries.length > limit;
    const sliced = hasNext ? deliveries.slice(0, limit) : deliveries;

    let nextCursor: string | null = null;
    if (hasNext && sliced.length > 0) {
      const last = sliced[sliced.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          id: last._id.toString(),
          ts: last.createdAt.toISOString(),
        })
      ).toString('base64');
    }

    return {
      deliveries: sliced,
      hasNext,
      nextCursor,
    };
  }

  async createDelivery(data: Partial<WebhookDeliveryDocument>): Promise<WebhookDeliveryDocument> {
    // 90 days retention TTL expiry calculation
    const retentionDays = 90;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    return WebhookDeliveryModel.create({
      _id: data._id || new mongoose.Types.ObjectId(),
      webhookId: data.webhookId,
      organizationId: data.organizationId,
      eventId: data.eventId,
      eventType: data.eventType,
      payload: data.payload,
      status: data.status || 'pending',
      statusCode: data.statusCode || null,
      responseTime: data.responseTime || null,
      attempt: data.attempt || 1,
      attempts: data.attempts || [],
      error: data.error || null,
      expiresAt,
    });
  }

  async updateDelivery(id: string, update: Partial<WebhookDeliveryDocument>): Promise<WebhookDeliveryDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return WebhookDeliveryModel.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
  }
}
