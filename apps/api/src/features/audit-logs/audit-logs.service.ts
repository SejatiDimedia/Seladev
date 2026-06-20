import mongoose from 'mongoose';
import type { AuditLogsRepository } from './audit-logs.repository';
import type { OrganizationsRepository } from '../organizations/organizations.repository';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import type { AuditLogFilters } from './audit-logs.types';

export class AuditLogsService {
  constructor(
    private readonly auditLogsRepo: AuditLogsRepository,
    private readonly orgRepo: OrganizationsRepository
  ) {}

  async record(data: {
    organizationId: string;
    projectId?: string | null;
    actor: {
      userId: string | null;
      email?: string;
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
  }): Promise<void> {
    // Non-blocking write: fire-and-forget
    const run = async () => {
      let email = data.actor.email;

      if (!email && data.actor.userId) {
        try {
          const User = mongoose.model('User');
          const userDoc = await User.findById(data.actor.userId).exec();
          email = userDoc ? userDoc.email : 'unknown-user';
        } catch (err) {
          email = 'unknown-user';
        }
      }

      await this.auditLogsRepo.create({
        organizationId: data.organizationId,
        projectId: data.projectId ?? null,
        actor: {
          userId: data.actor.userId,
          email: email || 'system',
          ipAddress: data.actor.ipAddress,
          userAgent: data.actor.userAgent,
        },
        action: data.action,
        resource: data.resource,
        metadata: data.metadata ?? null,
        outcome: data.outcome,
      });
    };

    run().catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('❌ [AuditLogService] Failed to write audit log:', err);
      }
    });
  }

  async listHistory(
    user: { id: string; role: string; orgId: string },
    orgIdOrSlug: string,
    limit: number,
    cursor?: string | null,
    filters?: AuditLogFilters
  ): Promise<{ logs: any[]; hasNext: boolean; nextCursor: string | null }> {
    // 1. Resolve organization by slug or ID
    let org = await this.orgRepo.findOrgById(orgIdOrSlug);
    if (!org) {
      org = await this.orgRepo.findOrgBySlug(orgIdOrSlug);
    }
    if (!org) {
      throw new NotFoundError('Organization', orgIdOrSlug);
    }

    // 2. Validate tenant scoping
    if (org.id !== user.orgId) {
      throw new ForbiddenError('Access denied: organization mismatch');
    }

    // 3. Validate user has owner or admin role
    const isAuthorized = user.role === 'owner' || user.role === 'admin';
    if (!isAuthorized) {
      throw new ForbiddenError('Access denied: only organization administrators can access audit logs');
    }

    // 4. Fetch from repository
    return this.auditLogsRepo.findMany(org.id, limit, cursor, filters);
  }
}
