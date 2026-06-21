import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { OrganizationsService } from '../organizations.service';
import { AuthService } from '../../auth/auth.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { authenticateJwt } from '../../../middleware/authenticate-jwt';
import { ForbiddenError } from '../../../lib/errors';
import * as jwtHelpers from '../../../lib/jwt';

// Register dummy schemas to prevent MissingSchemaError
if (!mongoose.models.User) {
  mongoose.model('User', new mongoose.Schema({}));
}
if (!mongoose.models.Organization) {
  mongoose.model('Organization', new mongoose.Schema({}));
}
if (!mongoose.models.Membership) {
  mongoose.model('Membership', new mongoose.Schema({}));
}
if (!mongoose.models.AuditLog) {
  mongoose.model('AuditLog', new mongoose.Schema({}));
}
if (!mongoose.models.RefreshToken) {
  mongoose.model('RefreshToken', new mongoose.Schema({}));
}
if (!mongoose.models.ApiKey) {
  mongoose.model('ApiKey', new mongoose.Schema({}));
}

describe('Team Workspaces (Phase 3.4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MASTER_ENCRYPTION_KEY = 'dummy_master_encryption_key_32_chars_long';

    // Mock models to prevent database connection hangs during middleware checks
    vi.spyOn(mongoose.model('Organization'), 'findById').mockReturnValue({
      exec: async () => null,
    } as any);
    vi.spyOn(mongoose.model('User'), 'findById').mockReturnValue({
      exec: async () => null,
    } as any);
  });

  describe('OrganizationsService.getUserOrgs', () => {
    it('should return all organizations that a user belongs to', async () => {
      const mockRepo = {
        findMembershipsByUser: vi.fn().mockResolvedValue([
          {
            organizationId: {
              toJSON: () => ({ id: 'org-1', name: 'Org 1', slug: 'org-1' }),
            },
          },
          {
            organizationId: {
              toJSON: () => ({ id: 'org-2', name: 'Org 2', slug: 'org-2' }),
            },
          },
        ]),
      } as any;

      const service = new OrganizationsService(mockRepo);
      const orgs = await service.getUserOrgs('user-123');

      expect(orgs).toHaveLength(2);
      expect(orgs[0]!.name).toBe('Org 1');
      expect(orgs[1]!.name).toBe('Org 2');
      expect(mockRepo.findMembershipsByUser).toHaveBeenCalledWith('user-123');
    });
  });

  describe('AuthService.switchOrg', () => {
    it('should switch organization context and return new tokens', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        isPlatformAdmin: true,
        isActive: true,
        toJSON: () => ({ id: 'user-123', email: 'user@example.com' }),
      };

      const mockMembership = {
        role: 'admin',
        organizationId: {
          name: 'Org 2',
        },
      };

      const mockAuthRepo = {
        findUserById: vi.fn().mockResolvedValue(mockUser),
        findActiveMembership: vi.fn().mockResolvedValue(mockMembership),
        createRefreshToken: vi.fn().mockResolvedValue({}),
      } as any;

      const mockAuditService = {
        record: vi.fn().mockResolvedValue({}),
      } as any;

      const service = new AuthService(mockAuthRepo, mockAuditService);

      const spySignAccessToken = vi.spyOn(jwtHelpers, 'signAccessToken').mockReturnValue('new-access-token');

      const result = await service.switchOrg('user-123', '60d21b4667d0d8992c616c22');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(mockAuthRepo.findActiveMembership).toHaveBeenCalledWith('user-123', '60d21b4667d0d8992c616c22');
      expect(spySignAccessToken).toHaveBeenCalledWith({
        sub: 'user-123',
        email: 'user@example.com',
        orgId: '60d21b4667d0d8992c616c22',
        role: 'admin',
        isPlatformAdmin: true,
      });
    });

    it('should throw ForbiddenError if user is not member of target organization', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        isActive: true,
      };

      const mockAuthRepo = {
        findUserById: vi.fn().mockResolvedValue(mockUser),
        findActiveMembership: vi.fn().mockResolvedValue(null),
      } as any;

      const service = new AuthService(mockAuthRepo);

      await expect(
        service.switchOrg('user-123', '60d21b4667d0d8992c616c22')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('authenticateJwt middleware with X-Org-Id header override', () => {
    it('should override user orgId and role if valid X-Org-Id header is supplied', async () => {

      vi.spyOn(jwtHelpers, 'verifyAccessToken').mockReturnValue({
        sub: '60d21b4667d0d8992c616c21',
        email: 'user@example.com',
        orgId: '60d21b4667d0d8992c616c23',
        role: 'member',
        type: 'access',
        jti: 'jti-123',
      });

      const mockMembership = {
        role: 'admin',
      };

      const spyFindOne = vi.fn().mockReturnValue({
        exec: async () => mockMembership,
      });
      vi.spyOn(mongoose.model('Membership'), 'findOne').mockImplementation(spyFindOne as any);

      // Setup mock express request/response/next
      const req = {
        headers: {
          authorization: 'Bearer valid-token',
          'x-org-id': '60d21b4667d0d8992c616c22',
        },
        method: 'GET',
        originalUrl: '/api/v1/projects',
      } as any;

      const res = {} as any;
      const next = vi.fn();

      await authenticateJwt(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.orgId).toBe('60d21b4667d0d8992c616c22');
      expect(req.user.role).toBe('admin');
      expect(spyFindOne).toHaveBeenCalled();
    });

    it('should throw ForbiddenError if X-Org-Id organization has no active membership', async () => {
      vi.spyOn(jwtHelpers, 'verifyAccessToken').mockReturnValue({
        sub: '60d21b4667d0d8992c616c21',
        email: 'user@example.com',
        orgId: '60d21b4667d0d8992c616c23',
        role: 'member',
        type: 'access',
        jti: 'jti-123',
      });

      vi.spyOn(mongoose.model('Membership'), 'findOne').mockReturnValue({
        exec: async () => null,
      } as any);

      const req = {
        headers: {
          authorization: 'Bearer valid-token',
          'x-org-id': '60d21b4667d0d8992c616c22',
        },
        method: 'GET',
        originalUrl: '/api/v1/projects',
      } as any;

      const res = {} as any;
      const next = vi.fn();

      await authenticateJwt(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should throw ForbiddenError if API Key orgId does not match X-Org-Id', async () => {
      // Mock ApiKey findOne to return valid key
      vi.spyOn(mongoose.model('ApiKey'), 'findOne').mockReturnValue({
        exec: async () => ({
          _id: new mongoose.Types.ObjectId(),
          organizationId: new mongoose.Types.ObjectId('60d21b4667d0d8992c616c33'),
          userId: new mongoose.Types.ObjectId(),
          isActive: true,
          scopes: ['projects:read'],
          name: 'My Key',
          save: async () => {},
        }),
      } as any);

      vi.spyOn(mongoose.model('Membership'), 'findOne').mockReturnValue({
        exec: async () => ({ role: 'member' }),
      } as any);

      const req = {
        headers: {
          authorization: 'Bearer sdv_sk_validapikeyprefix',
          'x-org-id': '60d21b4667d0d8992c616c22', // Mismatch!
        },
        method: 'GET',
        originalUrl: '/api/v1/projects',
      } as any;

      const res = {} as any;
      const next = vi.fn();

      await authenticateJwt(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
  });

  describe('AuditLogsService.listCrossWorkspaceHistory', () => {
    it('should allow platform admin to view logs across all workspaces', async () => {
      const mockAuditLogsRepo = {
        findManyCrossWorkspace: vi.fn().mockResolvedValue({
          logs: [{ id: 'log-1', action: 'project.created' }],
          hasNext: false,
          nextCursor: null,
        }),
      } as any;

      const mockOrgRepo = {} as any;
      const service = new AuditLogsService(mockAuditLogsRepo, mockOrgRepo);

      const result = await service.listCrossWorkspaceHistory(
        { id: 'user-123', role: 'member', orgId: 'org-1', isPlatformAdmin: true },
        20
      );

      expect(result.logs).toHaveLength(1);
      expect(mockAuditLogsRepo.findManyCrossWorkspace).toHaveBeenCalledWith(20, undefined, undefined);
    });

    it('should block non-platform admin from viewing cross-workspace logs', async () => {
      const mockAuditLogsRepo = {
        findManyCrossWorkspace: vi.fn(),
      } as any;

      const mockOrgRepo = {} as any;
      const service = new AuditLogsService(mockAuditLogsRepo, mockOrgRepo);

      await expect(
        service.listCrossWorkspaceHistory(
          { id: 'user-123', role: 'owner', orgId: 'org-1', isPlatformAdmin: false },
          20
        )
      ).rejects.toThrow(ForbiddenError);

      expect(mockAuditLogsRepo.findManyCrossWorkspace).not.toHaveBeenCalled();
    });
  });
});
