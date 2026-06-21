import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditLogsService } from '../audit-logs.service';
import type { AuditLogsRepository } from '../audit-logs.repository';
import type { OrganizationsRepository } from '../../organizations/organizations.repository';
import { ForbiddenError } from '../../../lib/errors';

// Helper to create mock Mongoose documents
function createMockAuditLogDoc(data: any) {
  return {
    id: data.id || 'log-123',
    organizationId: data.organizationId,
    projectId: data.projectId || null,
    actor: {
      userId: data.actor.userId,
      email: data.actor.email || 'user@example.com',
      ipAddress: data.actor.ipAddress,
      userAgent: data.actor.userAgent,
    },
    action: data.action,
    resource: data.resource,
    metadata: data.metadata || null,
    outcome: data.outcome,
    createdAt: data.createdAt || new Date(),
    toJSON: function () {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        projectId: this.projectId ? this.projectId.toString() : null,
        actor: {
          userId: this.actor.userId ? this.actor.userId.toString() : null,
          email: this.actor.email,
          ipAddress: this.actor.ipAddress,
          userAgent: this.actor.userAgent,
        },
        action: this.action,
        resource: this.resource,
        metadata: this.metadata,
        outcome: this.outcome,
        createdAt: this.createdAt.toISOString(),
      };
    },
  } as any;
}

class InMemoryAuditLogsRepository implements AuditLogsRepository {
  public logs: any[] = [];

  async create(data: any): Promise<any> {
    const log = createMockAuditLogDoc({
      ...data,
      id: `log-${this.logs.length + 1}`,
      createdAt: data.createdAt || new Date(),
    });
    this.logs.push(log);
    return log;
  }

  async findMany(
    organizationId: string,
    limit: number,
    cursor?: string | null,
    filters?: any
  ): Promise<{ logs: any[]; hasNext: boolean; nextCursor: string | null }> {
    let filtered = this.logs.filter((l) => l.organizationId === organizationId);

    if (filters) {
      if (filters.action) {
        filtered = filtered.filter((l) => l.action === filters.action);
      }
      if (filters.actorId) {
        filtered = filtered.filter((l) => l.actor.userId === filters.actorId);
      }
      if (filters.resourceType) {
        filtered = filtered.filter((l) => l.resource.type === filters.resourceType);
      }
    }

    // Sort: { createdAt: -1, _id: -1 }
    filtered.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('ascii');
      const [cursorTime, cursorId] = decoded.split('_');
      if (cursorTime && cursorId) {
        const timeVal = parseInt(cursorTime, 10);
        startIndex = filtered.findIndex(
          (l) => l.createdAt.getTime() === timeVal && l.id === cursorId
        );
        if (startIndex !== -1) {
          startIndex += 1; // start after cursor
        } else {
          startIndex = 0;
        }
      }
    }

    const sliced = filtered.slice(startIndex, startIndex + limit);
    const hasNext = filtered.length > startIndex + limit;

    let nextCursor: string | null = null;
    if (hasNext && sliced.length > 0) {
      const last = sliced[sliced.length - 1];
      const cursorStr = `${last.createdAt.getTime()}_${last.id}`;
      nextCursor = Buffer.from(cursorStr).toString('base64');
    }

    return {
      logs: sliced,
      hasNext,
      nextCursor,
    };
  }

  async findManyCrossWorkspace(
    limit: number,
    cursor?: string | null,
    filters?: any
  ): Promise<{ logs: any[]; hasNext: boolean; nextCursor: string | null }> {
    let filtered = [...this.logs];

    if (filters) {
      if (filters.action) {
        filtered = filtered.filter((l) => l.action === filters.action);
      }
      if (filters.actorId) {
        filtered = filtered.filter((l) => l.actor.userId === filters.actorId);
      }
      if (filters.resourceType) {
        filtered = filtered.filter((l) => l.resource.type === filters.resourceType);
      }
    }

    filtered.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('ascii');
      const [cursorTime, cursorId] = decoded.split('_');
      if (cursorTime && cursorId) {
        const timeVal = parseInt(cursorTime, 10);
        startIndex = filtered.findIndex(
          (l) => l.createdAt.getTime() === timeVal && l.id === cursorId
        );
        if (startIndex !== -1) {
          startIndex += 1;
        } else {
          startIndex = 0;
        }
      }
    }

    const sliced = filtered.slice(startIndex, startIndex + limit);
    const hasNext = filtered.length > startIndex + limit;

    let nextCursor: string | null = null;
    if (hasNext && sliced.length > 0) {
      const last = sliced[sliced.length - 1];
      const cursorStr = `${last.createdAt.getTime()}_${last.id}`;
      nextCursor = Buffer.from(cursorStr).toString('base64');
    }

    return {
      logs: sliced,
      hasNext,
      nextCursor,
    };
  }
}

class InMemoryOrganizationsRepository implements Partial<OrganizationsRepository> {
  public orgs: any[] = [];

  async findOrgById(id: string): Promise<any | null> {
    return this.orgs.find((o) => o.id === id) || null;
  }

  async findOrgBySlug(slug: string): Promise<any | null> {
    return this.orgs.find((o) => o.slug === slug) || null;
  }
}

describe('AuditLogsService', () => {
  let auditLogsRepo: InMemoryAuditLogsRepository;
  let orgRepo: InMemoryOrganizationsRepository;
  let service: AuditLogsService;

  const mockOrg = {
    id: 'org-123',
    name: 'Test Org',
    slug: 'test-org',
  };

  beforeEach(() => {
    auditLogsRepo = new InMemoryAuditLogsRepository();
    orgRepo = new InMemoryOrganizationsRepository();
    orgRepo.orgs.push(mockOrg);
    service = new AuditLogsService(auditLogsRepo, orgRepo as any);
  });

  describe('record', () => {
    it('should successfully record an audit log (fire-and-forget)', async () => {
      await service.record({
        organizationId: 'org-123',
        actor: {
          userId: 'user-123',
          email: 'user@example.com',
          ipAddress: '127.0.0.1',
          userAgent: 'Chrome',
        },
        action: 'project.created',
        resource: {
          type: 'project',
          id: 'proj-123',
          name: 'My Project',
        },
        outcome: 'success',
      });

      expect(auditLogsRepo.logs).toHaveLength(1);
      const log = auditLogsRepo.logs[0];
      expect(log.action).toBe('project.created');
      expect(log.resource.type).toBe('project');
      expect(log.actor.userId).toBe('user-123');
      expect(log.actor.email).toBe('user@example.com');
      expect(log.outcome).toBe('success');
    });

    it('should catch repository errors without throwing to caller', async () => {
      vi.spyOn(auditLogsRepo, 'create').mockRejectedValueOnce(new Error('DB Connection Fail'));

      // Should not throw
      await expect(
        service.record({
          organizationId: 'org-123',
          actor: {
            userId: 'user-123',
            email: 'user@example.com',
            ipAddress: '127.0.0.1',
            userAgent: 'Chrome',
          },
          action: 'project.created',
          resource: {
            type: 'project',
            id: 'proj-123',
            name: 'My Project',
          },
          outcome: 'success',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('listHistory', () => {
    const ownerUser = { id: 'user-123', role: 'owner', orgId: 'org-123' };
    const adminUser = { id: 'user-124', role: 'admin', orgId: 'org-123' };
    const memberUser = { id: 'user-125', role: 'member', orgId: 'org-123' };
    const wrongOrgUser = { id: 'user-123', role: 'owner', orgId: 'org-456' };

    beforeEach(async () => {
      // Seed some audit logs
      for (let i = 1; i <= 5; i++) {
        await service.record({
          organizationId: 'org-123',
          actor: {
            userId: 'user-123',
            email: 'user@example.com',
            ipAddress: '127.0.0.1',
            userAgent: 'Chrome',
          },
          action: i % 2 === 0 ? 'project.created' : 'secret.created',
          resource: {
            type: i % 2 === 0 ? 'project' : 'secret',
            id: `res-${i}`,
            name: `Resource ${i}`,
          },
          outcome: 'success',
        });
      }
    });

    it('should allow org owners and admins to list history', async () => {
      const resultOwner = await service.listHistory(ownerUser, 'org-123', 10);
      expect(resultOwner.logs).toHaveLength(5);

      const resultAdmin = await service.listHistory(adminUser, 'test-org', 10);
      expect(resultAdmin.logs).toHaveLength(5);
    });

    it('should throw ForbiddenError if user belongs to a different organization', async () => {
      await expect(
        service.listHistory(wrongOrgUser, 'org-123', 10)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError if user is only a member', async () => {
      await expect(
        service.listHistory(memberUser, 'org-123', 10)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should support pagination limits and cursors', async () => {
      const page1 = await service.listHistory(ownerUser, 'org-123', 2);
      expect(page1.logs).toHaveLength(2);
      expect(page1.hasNext).toBe(true);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await service.listHistory(ownerUser, 'org-123', 2, page1.nextCursor);
      expect(page2.logs).toHaveLength(2);
      expect(page2.hasNext).toBe(true);

      const page3 = await service.listHistory(ownerUser, 'org-123', 2, page2.nextCursor);
      expect(page3.logs).toHaveLength(1);
      expect(page3.hasNext).toBe(false);
      expect(page3.nextCursor).toBeNull();
    });

    it('should support filtering by action and resource type', async () => {
      const filteredAction = await service.listHistory(ownerUser, 'org-123', 10, null, {
        action: 'project.created',
      });
      expect(filteredAction.logs).toHaveLength(2);

      const filteredResource = await service.listHistory(ownerUser, 'org-123', 10, null, {
        resourceType: 'secret',
      });
      expect(filteredResource.logs).toHaveLength(3);
    });
  });
});
