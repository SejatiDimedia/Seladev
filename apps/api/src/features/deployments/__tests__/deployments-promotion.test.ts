import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeploymentsService } from '../deployments.service';
import type { DeploymentsRepository } from '../deployments.repository';
import type { ProjectsRepository } from '../../projects/projects.repository';
import { ValidationError, NotFoundError } from '../../../lib/errors';

// Mock queue and redis configuration
const mockQueueAdd = vi.fn();
vi.mock('../../../config/queue', () => ({
  getDeploymentsQueue: () => ({
    add: mockQueueAdd,
  }),
}));

vi.mock('../../../config/redis', () => ({
  getRedisClient: () => ({
    set: vi.fn(),
    get: vi.fn(),
  }),
}));

vi.mock('../../../config/socket', () => ({
  getSocketServer: () => ({
    to: () => ({
      emit: vi.fn(),
    }),
  }),
}));

function createMockDeploymentDoc(data: any) {
  return {
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
      };
    }
  } as any;
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

  async updateStatus(): Promise<any | null> { return null; }
  async appendLog(): Promise<any | null> { return null; }
  async listHistory(): Promise<any> { return { deployments: [], hasNext: false, nextCursor: null }; }
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

  async findProjectBySlug(orgId: string, slug: string): Promise<any | null> {
    return this.projects.find(p => p.organizationId === orgId && p.slug === slug.toLowerCase()) || null;
  }

  async findEnvironmentBySlug(projectId: string, slug: string): Promise<any | null> {
    return this.environments.find(e => e.projectId === projectId && e.slug === slug.toLowerCase()) || null;
  }

  // Stubs
  async createProject(): Promise<any> { return null; }
  async updateProject(): Promise<any | null> { return null; }
  async deleteProject(): Promise<boolean> { return false; }
  async listProjectsByOrg(): Promise<any[]> { return []; }
  async createEnvironment(): Promise<any> { return null; }
  async updateEnvironment(): Promise<any | null> { return null; }
  async deleteEnvironment(): Promise<boolean> { return false; }
  async listEnvironmentsByProject(): Promise<any[]> { return []; }
  async createProjectMember(): Promise<any> { return null; }
  async findProjectMember(): Promise<any | null> { return null; }
  async listProjectMembers(): Promise<any[]> { return []; }
  async removeProjectMember(): Promise<boolean> { return false; }
  async addProjectMember(): Promise<any> { return null; }
  async findProjectMemberById(): Promise<any | null> { return null; }
  async updateProjectMemberRole(): Promise<any | null> { return null; }
  async countProjectMembers(): Promise<number> { return 0; }
}

describe('Deployments Promotion integration tests', () => {
  let deploymentsRepo: InMemoryDeploymentsRepository;
  let projectsRepo: InMemoryProjectsRepository;
  let deploymentsService: DeploymentsService;
  
  const mockAuditRecord = vi.fn().mockResolvedValue(undefined);
  const mockWebhookPublish = vi.fn().mockResolvedValue(undefined);

  const mockUser = { id: 'user-1', role: 'admin', orgId: 'org-1' };
  const mockProject = {
    id: 'proj-1',
    organizationId: 'org-1',
    slug: 'my-project',
    name: 'My Project',
    settings: {
      allowedBranches: [] as string[],
      deploymentProtection: false,
    },
  };
  const mockEnvDev = { id: 'env-dev', slug: 'dev', projectId: 'proj-1', name: 'Development', isProtected: false };
  const mockEnvProd = { id: 'env-prod', slug: 'prod', projectId: 'proj-1', name: 'Production', isProtected: true };

  beforeEach(() => {
    deploymentsRepo = new InMemoryDeploymentsRepository();
    projectsRepo = new InMemoryProjectsRepository();
    
    // Inject mocks
    const auditLogsServiceMock = { record: mockAuditRecord } as any;
    const webhookPublisherMock = { publish: mockWebhookPublish } as any;
    
    deploymentsService = new DeploymentsService(
      deploymentsRepo,
      projectsRepo,
      auditLogsServiceMock,
      webhookPublisherMock
    );

    projectsRepo.projects.push(mockProject);
    projectsRepo.environments.push(mockEnvDev);
    projectsRepo.environments.push(mockEnvProd);

    mockQueueAdd.mockClear();
    mockAuditRecord.mockClear();
    mockWebhookPublish.mockClear();
  });

  it('successfully promotes a successful deployment to another environment', async () => {
    // 1. Create a successful source deployment in dev
    const sourceDep = await deploymentsRepo.createDeployment({
      organizationId: 'org-1',
      projectId: 'proj-1',
      environmentId: 'env-dev',
      version: 'v1.0.0',
      branch: 'main',
      commitSha: 'abc1234',
      commitMessage: 'feat: add home page',
      status: 'success',
      triggeredBy: 'user-1',
    });

    // 2. Promote dev deployment to prod (which has settings: deploymentProtection = false)
    const promoted = await deploymentsService.promoteDeployment(
      mockUser,
      'proj-1',
      sourceDep.id,
      'env-prod',
      { ipAddress: '127.0.0.1', userAgent: 'test-agent' }
    );

    expect(promoted).toBeDefined();
    expect(promoted.status).toBe('queued');
    expect(promoted.version).toBe('v1.0.0');
    expect(promoted.branch).toBe('main');
    expect(promoted.commitSha).toBe('abc1234');
    expect(promoted.commitMessage).toBe('feat: add home page');
    expect(promoted.environmentId).toBe('env-prod');

    // Should enqueue target job
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith('deployment-job', {
      deploymentId: promoted.id,
      orgId: 'org-1',
    });

    // Should record audit log
    expect(mockAuditRecord).toHaveBeenCalledTimes(1);
    expect(mockAuditRecord).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'deployment.promoted',
      resource: expect.objectContaining({ id: promoted.id }),
    }));

    // Should publish webhook
    expect(mockWebhookPublish).toHaveBeenCalledTimes(1);
    expect(mockWebhookPublish).toHaveBeenLastCalledWith(
      'deployment.triggered',
      'org-1',
      'proj-1',
      expect.objectContaining({
        deployment: expect.objectContaining({
          id: promoted.id,
          metadata: expect.objectContaining({
            promoted: true,
            sourceDeploymentId: sourceDep.id,
          }),
        }),
      })
    );
  });

  it('promotes deployment using target environment slug instead of ID', async () => {
    const sourceDep = await deploymentsRepo.createDeployment({
      organizationId: 'org-1',
      projectId: 'proj-1',
      environmentId: 'env-dev',
      version: 'v1.0.0',
      branch: 'main',
      status: 'success',
      triggeredBy: 'user-1',
    });

    const promoted = await deploymentsService.promoteDeployment(
      mockUser,
      'proj-1',
      sourceDep.id,
      'prod' // Using environment slug 'prod' instead of 'env-prod'
    );

    expect(promoted.environmentId).toBe('env-prod');
  });

  it('holds deployment as pending_approval if target environment is protected and deploymentProtection is enabled', async () => {
    // Enable deployment protection on project settings
    mockProject.settings.deploymentProtection = true;

    const sourceDep = await deploymentsRepo.createDeployment({
      organizationId: 'org-1',
      projectId: 'proj-1',
      environmentId: 'env-dev',
      version: 'v1.0.0',
      branch: 'main',
      status: 'success',
      triggeredBy: 'user-1',
    });

    const promoted = await deploymentsService.promoteDeployment(
      mockUser,
      'proj-1',
      sourceDep.id,
      'env-prod'
    );

    expect(promoted.status).toBe('pending_approval');
    // Should NOT enqueue job to BullMQ
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('throws ValidationError if source deployment is not successful', async () => {
    const sourceDepFailed = await deploymentsRepo.createDeployment({
      organizationId: 'org-1',
      projectId: 'proj-1',
      environmentId: 'env-dev',
      version: 'v1.0.0',
      branch: 'main',
      status: 'failed', // Failed status
      triggeredBy: 'user-1',
    });

    await expect(
      deploymentsService.promoteDeployment(mockUser, 'proj-1', sourceDepFailed.id, 'env-prod')
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError if trying to promote to the same environment', async () => {
    const sourceDep = await deploymentsRepo.createDeployment({
      organizationId: 'org-1',
      projectId: 'proj-1',
      environmentId: 'env-dev',
      version: 'v1.0.0',
      branch: 'main',
      status: 'success',
      triggeredBy: 'user-1',
    });

    await expect(
      deploymentsService.promoteDeployment(mockUser, 'proj-1', sourceDep.id, 'env-dev')
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError if deployment does not exist', async () => {
    await expect(
      deploymentsService.promoteDeployment(mockUser, 'proj-1', 'non-existent-id', 'env-prod')
    ).rejects.toThrow(NotFoundError);
  });
});
