import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecretsService } from '../secrets.service';
import type { SecretsRepository } from '../secrets.repository';
import type { ProjectsRepository } from '../../projects/projects.repository';
import { ForbiddenError, NotFoundError } from '../../../lib/errors';
import { encryptGcm } from '../../../lib/crypto';

function createMockSecretDoc(data: any) {
  return {
    id: data.id || 'secret-123',
    _id: data.id || 'secret-123',
    organizationId: data.organizationId,
    projectId: data.projectId,
    environmentId: data.environmentId,
    key: data.key.toUpperCase(),
    encryptedValue: data.encryptedValue,
    iv: data.iv,
    authTag: data.authTag,
    keyVersion: data.keyVersion || 1,
    version: data.version || 1,
    lastAccessedAt: data.lastAccessedAt || null,
    save: async function() { return this; },
  } as any;
}

class InMemorySecretsRepository implements SecretsRepository {
  public secrets: any[] = [];
  public versions: any[] = [];

  async findSecretById(id: string): Promise<any | null> {
    return this.secrets.find(x => x.id === id) || null;
  }
  async findSecretByKey(environmentId: string, key: string): Promise<any | null> {
    return this.secrets.find(x => x.environmentId === environmentId && x.key === key.toUpperCase()) || null;
  }
  async createSecret(data: any): Promise<any> {
    const s = createMockSecretDoc({ ...data, id: `secret-${this.secrets.length + 1}` });
    this.secrets.push(s);
    return s;
  }
  async updateSecret(id: string, update: Partial<any>): Promise<any | null> {
    const s = await this.findSecretById(id);
    if (!s) return null;
    Object.assign(s, update);
    return s;
  }
  async deleteSecret(id: string): Promise<boolean> {
    const len = this.secrets.length;
    this.secrets = this.secrets.filter(x => x.id !== id);
    return this.secrets.length < len;
  }
  async listSecretsByEnv(environmentId: string): Promise<any[]> {
    return this.secrets.filter(x => x.environmentId === environmentId);
  }
  async createSecretVersion(_data: any): Promise<any> { return null; }
  async findSecretVersionById(_id: string): Promise<any | null> { return null; }
  async listSecretVersions(_secretId: string): Promise<any[]> { return []; }
  async deleteSecretVersions(_secretId: string): Promise<boolean> { return true; }
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

  // Not used in bulk test
  async createProject(_data: any): Promise<any> { return null; }
  async updateProject(_id: string, _update: Partial<any>): Promise<any | null> { return null; }
  async listProjectsByOrg(_orgId: string): Promise<any[]> { return []; }
  async createEnvironment(_data: any): Promise<any> { return null; }
  async listEnvironmentsByProject(_projectId: string): Promise<any[]> { return []; }
  async updateEnvironment(_id: string, _update: Partial<any>): Promise<any | null> { return null; }
  async deleteEnvironment(_id: string): Promise<boolean> { return false; }
  async addProjectMember(_data: any): Promise<any> { return null; }
  async findProjectMember(_projectId: string, _userId: string): Promise<any | null> { return null; }
  async findProjectMemberById(_id: string): Promise<any | null> { return null; }
  async listProjectMembers(_projectId: string): Promise<any[]> { return []; }
  async updateProjectMemberRole(_id: string, _role: any): Promise<any | null> { return null; }
  async removeProjectMember(_id: string): Promise<boolean> { return false; }
  async countProjectMembers(_projectId: string): Promise<number> { return 0; }
}

describe('Secrets Bulk Reveal (npx seladev pull backend) Tests', () => {
  let secretsRepo: InMemorySecretsRepository;
  let projectsRepo: InMemoryProjectsRepository;
  let secretsService: SecretsService;
  
  const mockAuditRecord = vi.fn().mockResolvedValue(undefined);
  const mockAuditLogsService = {
    record: mockAuditRecord,
  } as any;

  const mockOrgId = 'org-123';
  const mockProjectId = 'project-456';
  const mockDevEnvId = 'env-dev';
  const mockProdEnvId = 'env-prod';

  // Users
  const developerUser = { id: 'user-dev', role: 'member', orgId: mockOrgId, projectRole: 'developer' };
  const adminUser = { id: 'user-admin', role: 'member', orgId: mockOrgId, projectRole: 'admin' };
  const orgOwner = { id: 'user-owner', role: 'owner', orgId: mockOrgId };

  beforeEach(() => {
    vi.clearAllMocks();
    secretsRepo = new InMemorySecretsRepository();
    projectsRepo = new InMemoryProjectsRepository();
    secretsService = new SecretsService(secretsRepo, projectsRepo, mockAuditLogsService);

    // Setup project
    projectsRepo.projects.push({
      id: mockProjectId,
      organizationId: mockOrgId,
      name: 'Seladev Main',
      slug: 'seladev-main',
    });

    // Setup environments
    projectsRepo.environments.push({
      id: mockDevEnvId,
      projectId: mockProjectId,
      organizationId: mockOrgId,
      name: 'development',
      slug: 'development',
      isProtected: false,
    });
    projectsRepo.environments.push({
      id: mockProdEnvId,
      projectId: mockProjectId,
      organizationId: mockOrgId,
      name: 'production',
      slug: 'production',
      isProtected: true,
    });
  });

  it('should successfully bulk reveal secrets in standard environment for developer', async () => {
    // Encrypt some secrets
    const enc1 = encryptGcm('value-one', mockOrgId);
    const enc2 = encryptGcm('value-two', mockOrgId);

    await secretsRepo.createSecret({
      projectId: mockProjectId,
      environmentId: mockDevEnvId,
      organizationId: mockOrgId,
      key: 'DATABASE_URL',
      encryptedValue: enc1.ciphertext,
      iv: enc1.iv,
      authTag: enc1.authTag,
      createdBy: 'user-admin',
    });

    await secretsRepo.createSecret({
      projectId: mockProjectId,
      environmentId: mockDevEnvId,
      organizationId: mockOrgId,
      key: 'API_KEY',
      encryptedValue: enc2.ciphertext,
      iv: enc2.iv,
      authTag: enc2.authTag,
      createdBy: 'user-admin',
    });

    const result = await secretsService.revealAllSecrets(developerUser, mockProjectId, mockDevEnvId);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ key: 'DATABASE_URL', value: 'value-one' });
    expect(result).toContainEqual({ key: 'API_KEY', value: 'value-two' });

    // Assert audit logs recorded for EACH secret revealed
    expect(mockAuditRecord).toHaveBeenCalledTimes(2);
    expect(mockAuditRecord).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'secret.revealed',
      resource: expect.objectContaining({ type: 'secret' }),
    }));
  });

  it('should successfully resolve slugs dynamically', async () => {
    const enc1 = encryptGcm('slug-value', mockOrgId);

    await secretsRepo.createSecret({
      projectId: mockProjectId,
      environmentId: mockDevEnvId,
      organizationId: mockOrgId,
      key: 'SLUG_TEST',
      encryptedValue: enc1.ciphertext,
      iv: enc1.iv,
      authTag: enc1.authTag,
      createdBy: 'user-admin',
    });

    const result = await secretsService.revealAllSecrets(developerUser, 'seladev-main', 'development');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: 'SLUG_TEST', value: 'slug-value' });
  });

  it('should prevent developer from bulk revealing secrets in protected environment', async () => {
    const enc1 = encryptGcm('prod-value', mockOrgId);

    await secretsRepo.createSecret({
      projectId: mockProjectId,
      environmentId: mockProdEnvId,
      organizationId: mockOrgId,
      key: 'PROD_DB',
      encryptedValue: enc1.ciphertext,
      iv: enc1.iv,
      authTag: enc1.authTag,
      createdBy: 'user-admin',
    });

    await expect(
      secretsService.revealAllSecrets(developerUser, mockProjectId, mockProdEnvId)
    ).rejects.toThrow(ForbiddenError);
  });

  it('should allow project admin and org owner to bulk reveal secrets in protected environment', async () => {
    const enc1 = encryptGcm('prod-value', mockOrgId);

    await secretsRepo.createSecret({
      projectId: mockProjectId,
      environmentId: mockProdEnvId,
      organizationId: mockOrgId,
      key: 'PROD_DB',
      encryptedValue: enc1.ciphertext,
      iv: enc1.iv,
      authTag: enc1.authTag,
      createdBy: 'user-admin',
    });

    const adminResult = await secretsService.revealAllSecrets(adminUser, mockProjectId, mockProdEnvId);
    expect(adminResult).toHaveLength(1);
    expect(adminResult[0]!.value).toBe('prod-value');

    const ownerResult = await secretsService.revealAllSecrets(orgOwner, mockProjectId, mockProdEnvId);
    expect(ownerResult).toHaveLength(1);
    expect(ownerResult[0]!.value).toBe('prod-value');
  });

  it('should throw NotFoundError if project or environment does not exist', async () => {
    await expect(
      secretsService.revealAllSecrets(developerUser, 'invalid-project', mockDevEnvId)
    ).rejects.toThrow(NotFoundError);

    await expect(
      secretsService.revealAllSecrets(developerUser, mockProjectId, 'invalid-env')
    ).rejects.toThrow(NotFoundError);
  });

  it('should enforce API key project scoping boundaries', async () => {
    const scopedUser = {
      ...developerUser,
      apiKeyProjectId: 'different-project-id',
    };

    await expect(
      secretsService.revealAllSecrets(scopedUser, mockProjectId, mockDevEnvId)
    ).rejects.toThrow(ForbiddenError);
  });
});
