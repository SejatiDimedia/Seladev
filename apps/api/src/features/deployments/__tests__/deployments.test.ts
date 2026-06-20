import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeploymentsService } from '../deployments.service';
import type { DeploymentsRepository } from '../deployments.repository';
import type { ProjectsRepository } from '../../projects/projects.repository';
import { ValidationError, ForbiddenError } from '../../../lib/errors';
import type { DeploymentStatus, StatusEvent } from '@seladev/types';

// Mock queue and redis configuration
const mockQueueAdd = vi.fn();
const mockQueueGetJob = vi.fn();

vi.mock('../../../config/queue', () => ({
  getDeploymentsQueue: () => ({
    add: mockQueueAdd,
    getJob: mockQueueGetJob,
  }),
}));

const mockRedisSet = vi.fn();
const mockRedisGet = vi.fn();

vi.mock('../../../config/redis', () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    get: mockRedisGet,
  }),
}));

vi.mock('../../../config/socket', () => ({
  getSocketServer: () => ({
    to: () => ({
      emit: vi.fn(),
    }),
  }),
}));

// Mock helpers for Mongoose-like documents
function createMockDeploymentDoc(data: any) {
  const doc = {
    id: data.id || 'dep-123',
    _id: data.id || 'dep-123',
    organizationId: data.organizationId,
    projectId: data.projectId,
    environmentId: data.environmentId,
    version: data.version,
    branch: data.branch,
    commitSha: data.commitSha,
    commitMessage: data.commitMessage,
    status: data.status,
    statusHistory: data.statusHistory || [],
    triggeredBy: data.triggeredBy,
    triggeredVia: data.triggeredVia || 'ui',
    buildLogs: data.buildLogs || [],
    duration: data.duration || null,
    errorMessage: data.errorMessage || null,
    completedAt: data.completedAt || null,
    save: async function() { return this; },
    toJSON: function() {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        projectId: this.projectId.toString(),
        environmentId: this.environmentId.toString(),
        version: this.version,
        branch: this.branch,
        commitSha: this.commitSha,
        commitMessage: this.commitMessage,
        status: this.status,
        statusHistory: this.statusHistory,
        triggeredBy: this.triggeredBy.toString(),
        triggeredVia: this.triggeredVia,
        buildLogs: this.buildLogs,
        duration: this.duration,
        errorMessage: this.errorMessage,
        completedAt: this.completedAt ? this.completedAt.toISOString() : null,
      };
    }
  };
  return doc as any;
}

class InMemoryDeploymentsRepository implements DeploymentsRepository {
  public deployments: any[] = [];

  async findDeploymentById(id: string): Promise<any | null> {
    return this.deployments.find(d => d.id === id) || null;
  }

  async createDeployment(data: any): Promise<any> {
    const deployment = createMockDeploymentDoc({
      ...data,
      id: `dep-${this.deployments.length + 1}`,
    });
    this.deployments.push(deployment);
    return deployment;
  }

  async updateStatus(
    id: string,
    status: DeploymentStatus,
    event: StatusEvent,
    completedAt?: Date | null,
    duration?: number | null,
    errorMessage?: string | null
  ): Promise<any | null> {
    const dep = await this.findDeploymentById(id);
    if (!dep) return null;

    dep.status = status;
    dep.statusHistory.push(event);
    if (completedAt !== undefined) dep.completedAt = completedAt;
    if (duration !== undefined) dep.duration = duration;
    if (errorMessage !== undefined) dep.errorMessage = errorMessage;

    return dep;
  }

  async appendLog(id: string, logLine: string): Promise<any | null> {
    const dep = await this.findDeploymentById(id);
    if (!dep) return null;
    dep.buildLogs.push(logLine);
    return dep;
  }

  async listHistory(
    projectId: string,
    limit: number,
    cursor?: string | null,
    filters?: any
  ): Promise<{ deployments: any[]; hasNext: boolean; nextCursor: string | null }> {
    let filtered = this.deployments.filter(d => d.projectId === projectId);
    
    if (filters?.environmentId) {
      filtered = filtered.filter(d => d.environmentId === filters.environmentId);
    }
    if (filters?.status) {
      filtered = filtered.filter(d => d.status === filters.status);
    }

    // Sort by id descending for newest first
    filtered.sort((a, b) => b.id.localeCompare(a.id));

    if (cursor) {
      const decodedId = Buffer.from(cursor, 'base64').toString('utf8');
      const idx = filtered.findIndex(d => d.id === decodedId);
      if (idx !== -1) {
        filtered = filtered.slice(idx + 1);
      }
    }

    const hasNext = filtered.length > limit;
    const sliced = hasNext ? filtered.slice(0, limit) : filtered;

    let nextCursor: string | null = null;
    if (hasNext && sliced.length > 0) {
      nextCursor = Buffer.from(sliced[sliced.length - 1]!.id).toString('base64');
    }

    return {
      deployments: sliced,
      hasNext,
      nextCursor,
    };
  }
}

class InMemoryProjectsRepository implements ProjectsRepository {
  public projects: any[] = [];
  public environments: any[] = [];

  async findProjectById(id: string): Promise<any | null> {
    return this.projects.find(p => p.id === id) || null;
  }

  async findEnvironmentById(id: string): Promise<any | null> {
    return this.environments.find(e => e.id === id) || null;
  }

  async findProjectBySlug(_orgId: string, _slug: string): Promise<any | null> { return null; }
  async createProject(_data: any): Promise<any> { return null; }
  async updateProject(_id: string, _update: any): Promise<any | null> { return null; }
  async deleteProject(_id: string): Promise<boolean> { return false; }
  async listProjectsByOrg(_orgId: string): Promise<any[]> { return []; }
  async createEnvironment(_data: any): Promise<any> { return null; }
  async updateEnvironment(_id: string, _update: any): Promise<any | null> { return null; }
  async deleteEnvironment(_id: string): Promise<boolean> { return false; }
  async listEnvironmentsByProject(_projectId: string): Promise<any[]> { return []; }
  async createProjectMember(_data: any): Promise<any> { return null; }
  async findProjectMember(_projectId: string, _userId: string): Promise<any | null> { return null; }
  async listProjectMembers(_projectId: string): Promise<any[]> { return []; }
  async removeProjectMember(_id: string): Promise<boolean> { return false; }
  async findEnvironmentBySlug(_projectId: string, _slug: string): Promise<any | null> { return null; }
  async addProjectMember(_data: any): Promise<any> { return null; }
  async findProjectMemberById(_id: string): Promise<any | null> { return null; }
  async updateProjectMemberRole(_id: string, _role: any): Promise<any | null> { return null; }
  async countProjectMembers(_projectId: string): Promise<number> { return 0; }
}

describe('Deployments Feature Slice', () => {
  let deploymentsRepo: InMemoryDeploymentsRepository;
  let projectsRepo: InMemoryProjectsRepository;
  let deploymentsService: DeploymentsService;

  const mockUser = { id: 'user-1', role: 'admin', orgId: 'org-1', projectRole: 'admin' };
  const mockProject = {
    id: 'proj-1',
    organizationId: 'org-1',
    name: 'Proj 1',
    settings: {
      allowedBranches: [] as string[],
      deploymentProtection: false,
    },
  };
  const mockEnv = { id: 'env-1', projectId: 'proj-1', name: 'Production', isProtected: true };
  const mockEnv2 = { id: 'env-2', projectId: 'proj-1', name: 'Development', isProtected: false };

  beforeEach(() => {
    deploymentsRepo = new InMemoryDeploymentsRepository();
    projectsRepo = new InMemoryProjectsRepository();
    deploymentsService = new DeploymentsService(deploymentsRepo, projectsRepo);

    projectsRepo.projects.push(mockProject);
    projectsRepo.environments.push(mockEnv);
    projectsRepo.environments.push(mockEnv2);

    mockQueueAdd.mockClear();
    mockQueueGetJob.mockClear();
    mockRedisSet.mockClear();
    mockRedisGet.mockClear();
  });

  describe('Triggering Deployments', () => {
    it('triggers and enqueues deployment successfully in standard environment', async () => {
      const dto = { environmentId: 'env-2', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);

      expect(deployment).toBeDefined();
      expect(deployment.status).toBe('queued');
      expect(deployment.branch).toBe('main');
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    });

    it('triggers and holds deployment in pending_approval in protected environment with protection enabled', async () => {
      // Enable deployment protection
      mockProject.settings.deploymentProtection = true;

      const dto = { environmentId: 'env-1', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);

      expect(deployment.status).toBe('pending_approval');
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('validates branch restrictions and throws error on mismatch', async () => {
      mockProject.settings.allowedBranches = ['main', 'release/*'];

      const dto = { environmentId: 'env-2', branch: 'feature/login' };
      await expect(
        deploymentsService.triggerDeployment(mockUser, 'proj-1', dto)
      ).rejects.toThrow(ValidationError);
    });

    it('allows deployment if branch matches allowed branch patterns', async () => {
      mockProject.settings.allowedBranches = ['main', 'release/*'];

      const dto = { environmentId: 'env-2', branch: 'release/v1.0' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);
      expect(deployment.status).toBe('queued');
    });
  });

  describe('Approvals and Rejections', () => {
    beforeEach(() => {
      mockProject.settings.deploymentProtection = true;
    });

    it('allows admin to approve a pending_approval deployment', async () => {
      const dto = { environmentId: 'env-1', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);
      expect(deployment.status).toBe('pending_approval');

      const approved = await deploymentsService.approveDeployment(mockUser, 'proj-1', deployment.id);
      expect(approved.status).toBe('queued');
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenError if non-admin tries to approve', async () => {
      const regularUser = { id: 'user-2', role: 'member', orgId: 'org-1', projectRole: 'developer' };
      const dto = { environmentId: 'env-1', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);

      await expect(
        deploymentsService.approveDeployment(regularUser, 'proj-1', deployment.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows admin to reject a pending_approval deployment', async () => {
      const dto = { environmentId: 'env-1', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);

      const rejected = await deploymentsService.rejectDeployment(mockUser, 'proj-1', deployment.id);
      expect(rejected.status).toBe('cancelled');
      expect(rejected.completedAt).toBeDefined();
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe('Cancellation', () => {
    it('cancels queued deployment and removes from BullMQ', async () => {
      const dto = { environmentId: 'env-2', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);
      expect(deployment.status).toBe('queued');

      const mockJob = { remove: vi.fn() };
      mockQueueGetJob.mockResolvedValueOnce(mockJob);

      const cancelled = await deploymentsService.cancelDeployment(mockUser, 'proj-1', deployment.id);
      expect(cancelled.status).toBe('cancelled');
      expect(mockJob.remove).toHaveBeenCalledTimes(1);
    });

    it('cancels building deployment by writing Redis cancellation key', async () => {
      const dto = { environmentId: 'env-2', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);
      
      // Manually set status to building to simulate active worker pickup
      deployment.status = 'building';

      const cancelled = await deploymentsService.cancelDeployment(mockUser, 'proj-1', deployment.id);
      expect(cancelled.status).toBe('building'); // Stays building in DB until worker picks up cancellation
      expect(mockRedisSet).toHaveBeenCalledWith(`deployment:cancel:${deployment.id}`, '1', { EX: 600 });
    });

    it('throws ValidationError if trying to cancel deploying status', async () => {
      const dto = { environmentId: 'env-2', branch: 'main' };
      const deployment = await deploymentsService.triggerDeployment(mockUser, 'proj-1', dto);
      deployment.status = 'deploying';

      await expect(
        deploymentsService.cancelDeployment(mockUser, 'proj-1', deployment.id)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('History & Cursor Pagination', () => {
    it('returns history with nextCursor and hasNext correctly', async () => {
      await deploymentsRepo.createDeployment({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environmentId: 'env-2',
        version: 'v1',
        branch: 'main',
        status: 'success',
        triggeredBy: 'user-1',
        triggeredVia: 'ui',
      });
      await deploymentsRepo.createDeployment({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environmentId: 'env-2',
        version: 'v2',
        branch: 'main',
        status: 'success',
        triggeredBy: 'user-1',
        triggeredVia: 'ui',
      });
      await deploymentsRepo.createDeployment({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environmentId: 'env-2',
        version: 'v3',
        branch: 'main',
        status: 'success',
        triggeredBy: 'user-1',
        triggeredVia: 'ui',
      });

      // Fetch page 1 (limit 2)
      const page1 = await deploymentsService.listHistory(mockUser, 'proj-1', 2);
      expect(page1.deployments.length).toBe(2);
      expect(page1.hasNext).toBe(true);
      expect(page1.nextCursor).toBeDefined();

      // Fetch page 2
      const page2 = await deploymentsService.listHistory(mockUser, 'proj-1', 2, page1.nextCursor);
      expect(page2.deployments.length).toBe(1);
      expect(page2.hasNext).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });
  });
});
