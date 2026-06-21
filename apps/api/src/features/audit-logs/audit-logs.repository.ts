import mongoose from 'mongoose';
import type { AuditLogDocument } from '../../infrastructure/database/models/audit-log.model';
import { AuditLogModel } from '../../infrastructure/database/models/audit-log.model';
import type { AuditLogFilters } from './audit-logs.types';

export interface AuditLogsRepository {
  create(data: {
    organizationId: string;
    projectId?: string | null;
    actor: {
      userId: string | null;
      email: string;
      ipAddress: string | null;
      userAgent: string | null;
    };
    action: string;
    resource: {
      type: string;
      id: string;
      name: string;
    };
    metadata?: Record<string, unknown> | null;
    outcome: 'success' | 'failure';
  }): Promise<AuditLogDocument>;

  findMany(
    organizationId: string,
    limit: number,
    cursor?: string | null,
    filters?: AuditLogFilters
  ): Promise<{ logs: AuditLogDocument[]; hasNext: boolean; nextCursor: string | null }>;

  findManyCrossWorkspace(
    limit: number,
    cursor?: string | null,
    filters?: AuditLogFilters
  ): Promise<{ logs: AuditLogDocument[]; hasNext: boolean; nextCursor: string | null }>;
}

export class MongooseAuditLogsRepository implements AuditLogsRepository {
  async create(data: {
    organizationId: string;
    projectId?: string | null;
    actor: {
      userId: string | null;
      email: string;
      ipAddress: string | null;
      userAgent: string | null;
    };
    action: string;
    resource: {
      type: string;
      id: string;
      name: string;
    };
    metadata?: Record<string, unknown> | null;
    outcome: 'success' | 'failure';
  }): Promise<AuditLogDocument> {
    return AuditLogModel.create({
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : null,
      actor: {
        userId: data.actor.userId ? new mongoose.Types.ObjectId(data.actor.userId) : null,
        email: data.actor.email,
        ipAddress: data.actor.ipAddress,
        userAgent: data.actor.userAgent,
      },
      action: data.action,
      resource: {
        type: data.resource.type,
        id: data.resource.id,
        name: data.resource.name,
      },
      metadata: data.metadata || {},
      outcome: data.outcome,
    });
  }

  async findMany(
    organizationId: string,
    limit: number,
    cursor?: string | null,
    filters?: AuditLogFilters
  ): Promise<{ logs: AuditLogDocument[]; hasNext: boolean; nextCursor: string | null }> {
    const query: any = {
      organizationId: new mongoose.Types.ObjectId(organizationId),
    };

    if (filters) {
      if (filters.actorId) {
        query['actor.userId'] = new mongoose.Types.ObjectId(filters.actorId);
      }
      if (filters.actorEmail) {
        query['actor.email'] = { $regex: new RegExp(filters.actorEmail, 'i') };
      }
      if (filters.action) {
        if (Array.isArray(filters.action)) {
          query.action = { $in: filters.action };
        } else {
          query.action = filters.action;
        }
      }
      if (filters.resourceType) {
        query['resource.type'] = filters.resourceType;
      }
      if (filters.resourceId) {
        query['resource.id'] = filters.resourceId;
      }
      if (filters.outcome) {
        query.outcome = filters.outcome;
      }
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) {
          query.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.createdAt.$lte = new Date(filters.endDate);
        }
      }
    }

    // Apply cursor conditions
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        const { id, ts } = decoded;
        if (id && ts) {
          query.$or = [
            { createdAt: { $lt: new Date(ts) } },
            { createdAt: new Date(ts), _id: { $lt: new mongoose.Types.ObjectId(id) } },
          ];
        }
      } catch (err) {
        // Fallback: ignore invalid cursor
      }
    }

    // Fetch limit + 1 to determine hasNext page
    const logs = await AuditLogModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNext = logs.length > limit;
    const slicedLogs = hasNext ? logs.slice(0, limit) : logs;

    let nextCursor: string | null = null;
    if (hasNext && slicedLogs.length > 0) {
      const lastDoc = slicedLogs[slicedLogs.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          id: lastDoc._id.toString(),
          ts: lastDoc.createdAt.toISOString(),
        })
      ).toString('base64');
    }

    return {
      logs: slicedLogs,
      hasNext,
      nextCursor,
    };
  }

  async findManyCrossWorkspace(
    limit: number,
    cursor?: string | null,
    filters?: AuditLogFilters
  ): Promise<{ logs: AuditLogDocument[]; hasNext: boolean; nextCursor: string | null }> {
    const query: any = {};

    if (filters) {
      if (filters.actorId) {
        query['actor.userId'] = new mongoose.Types.ObjectId(filters.actorId);
      }
      if (filters.actorEmail) {
        query['actor.email'] = { $regex: new RegExp(filters.actorEmail, 'i') };
      }
      if (filters.action) {
        if (Array.isArray(filters.action)) {
          query.action = { $in: filters.action };
        } else {
          query.action = filters.action;
        }
      }
      if (filters.resourceType) {
        query['resource.type'] = filters.resourceType;
      }
      if (filters.resourceId) {
        query['resource.id'] = filters.resourceId;
      }
      if (filters.outcome) {
        query.outcome = filters.outcome;
      }
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) {
          query.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.createdAt.$lte = new Date(filters.endDate);
        }
      }
    }

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        const { id, ts } = decoded;
        if (id && ts) {
          query.$or = [
            { createdAt: { $lt: new Date(ts) } },
            { createdAt: new Date(ts), _id: { $lt: new mongoose.Types.ObjectId(id) } },
          ];
        }
      } catch (err) {
        // Fallback
      }
    }

    const logs = await AuditLogModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNext = logs.length > limit;
    const slicedLogs = hasNext ? logs.slice(0, limit) : logs;

    let nextCursor: string | null = null;
    if (hasNext && slicedLogs.length > 0) {
      const lastDoc = slicedLogs[slicedLogs.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          id: lastDoc._id.toString(),
          ts: lastDoc.createdAt.toISOString(),
        })
      ).toString('base64');
    }

    return {
      logs: slicedLogs,
      hasNext,
      nextCursor,
    };
  }
}
