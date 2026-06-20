import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeysService } from '../api-keys.service';
import type { ApiKeysRepository } from '../api-keys.repository';
import type { ProjectsRepository } from '../../projects/projects.repository';
import type { OrganizationsRepository } from '../../organizations/organizations.repository';
import { SecretsService } from '../../secrets/secrets.service';
import type { SecretsRepository } from '../../secrets/secrets.repository';
import { ValidationError, ForbiddenError } from '../../../lib/errors';

// Mock helpers for Mongoose API key document
function createMockApiKeyDoc(data: any) {
  const doc = {
    id: data.id || 'key-123',
    _id: data.id || 'key-123',
    organizationId: data.organizationId,
    projectId: data.projectId || null,
    environmentId: data.environmentId || null,
    userId: data.userId,
    name: data.name,
    keyHash: data.keyHash,
    keyPrefix: data.keyPrefix,
    scopes: data.scopes || [],
    lastUsedAt: data.lastUsedAt || null,
    expiresAt: data.expiresAt || null,
    isActive: data.isActive !== undefined ? data.isActive : true,
    save: async function() { return this; },
    toJSON: function() {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        projectId: this.projectId ? this.projectId.toString() : null,
        environmentId: this.environmentId ? this.environmentId.toString() : null,
        userId: this.userId.toString(),
        name: this.name,
        keyPrefix: this.keyPrefix,
        scopes: this.scopes,
        lastUsedAt: this.lastUsedAt ? this.lastUsedAt.toISOString() : null,
        expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
        isActive: this.isActive,
      };
    }
  };
  return doc as any;
}

class InMemoryApiKeysRepository implements ApiKeysRepository {
  public keys: any[] = [];

  async findKeyById(id: string): Promise<any | null> {
    return this.keys.find(k => k.id === id) || null;
  }

  async findKeyByHash(keyHash: string): Promise<any | null> {
    return this.keys.find(k => k.keyHash === keyHash) || null;
  }

  async createKey(data: any): Promise<any> {
    const key = createMockApiKeyDoc({
      ...data,
      id: `key-${this.keys.length + 1}`,
    });
    this.keys.push(key);
    return key;
  }

  async updateKey(id: string, update: Partial<any>): Promise<any | null> {
    const key = await this.findKeyById(id);
    if (!key) return null;
    Object.assign(key, update);
    return key;
  }

  async listKeysByOrg(organizationId: string): Promise<any[]> {
    return this.keys.filter(k => k.organizationId === organizationId);
  }

  async deleteKey(id: string): Promise<boolean> {
    const len = this.keys.length;
    this.keys = this.keys.filter(k => k.id !== id);
    return this.keys.length < len;
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

class InMemoryOrganizationsRepository implements OrganizationsRepository {
  public orgs: any[] = [];

  async findOrgById(id: string): Promise<any | null> {
    return this.orgs.find(o => o.id === id) || null;
  }

  async findOrgBySlug(slug: string): Promise<any | null> {
    return this.orgs.find(o => o.slug === slug) || null;
  }

  async createOrg(_data: any): Promise<any> { return null; }
  async updateOrg(_id: string, _update: any): Promise<any | null> { return null; }
  async listUserOrgs(_userId: string): Promise<any[]> { return []; }
  async createMembership(_data: any): Promise<any> { return null; }
  async findMembership(_orgId: string, _userId: string): Promise<any | null> { return null; }
  async listMemberships(_orgId: string): Promise<any[]> { return []; }
  async updateMembershipRole(_orgId: string, _userId: string, _role: string): Promise<any | null> { return null; }
  async removeMembership(_orgId: string, _userId: string): Promise<boolean> { return false; }
  async findMembershipsByOrg(_orgId: string): Promise<any[]> { return []; }
  async updateMembership(_id: string, _update: any): Promise<any | null> { return null; }
  async deleteMembership(_id: string): Promise<boolean> { return false; }
  async countOrgMembers(_orgId: string): Promise<number> { return 0; }
  async findUserByEmail(_email: string): Promise<any | null> { return null; }
}

class InMemorySecretsRepository implements SecretsRepository {
  public secrets: any[] = [];
  public versions: any[] = [];

  async findSecretById(id: string): Promise<any | null> {
    return this.secrets.find(s => s.id === id) || null;
  }

  async findSecretByKey(environmentId: string, key: string): Promise<any | null> {
    return this.secrets.find(s => s.environmentId === environmentId && s.key === key.toUpperCase()) || null;
  }

  async createSecret(data: any): Promise<any> {
    const s = {
      ...data,
      id: `secret-${this.secrets.length + 1}`,
      version: data.version || 1,
      save: async function() { return this; },
      toJSON: function() { return this; }
    };
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
    this.secrets = this.secrets.filter(s => s.id !== id);
    return this.secrets.length < len;
  }

  async listSecretsByEnv(environmentId: string): Promise<any[]> {
    return this.secrets.filter(s => s.environmentId === environmentId);
  }

  async createSecretVersion(data: any): Promise<any> {
    const v = { ...data, id: `version-${this.versions.length + 1}` };
    this.versions.push(v);
    return v;
  }

  async listSecretVersions(secretId: string): Promise<any[]> {
    return this.versions.filter(v => v.secretId === secretId);
  }

  async deleteSecretVersions(secretId: string): Promise<boolean> {
    this.versions = this.versions.filter(v => v.secretId !== secretId);
    return true;
  }

  async findSecretVersionById(id: string): Promise<any | null> {
    return this.versions.find(v => v.id === id) || null;
  }
}

describe('API Keys & Environment Scoping Feature Slice', () => {
  let apiKeysRepo: InMemoryApiKeysRepository;
  let projectsRepo: InMemoryProjectsRepository;
  let orgRepo: InMemoryOrganizationsRepository;
  let apiKeysService: ApiKeysService;

  let secretsRepo: InMemorySecretsRepository;
  let secretsService: SecretsService;

  const mockUser = { id: 'user-1', role: 'admin', orgId: 'org-1' };
  const mockOrg = { id: 'org-1', slug: 'my-org', name: 'My Org' };
  const mockProject = { id: 'proj-1', organizationId: 'org-1', name: 'Proj 1' };
  const mockEnv = { id: 'env-1', projectId: 'proj-1', name: 'Production', isProtected: false };
  const mockEnv2 = { id: 'env-2', projectId: 'proj-1', name: 'Staging', isProtected: false };

  beforeEach(() => {
    apiKeysRepo = new InMemoryApiKeysRepository();
    projectsRepo = new InMemoryProjectsRepository();
    orgRepo = new InMemoryOrganizationsRepository();
    apiKeysService = new ApiKeysService(apiKeysRepo, projectsRepo, orgRepo);

    secretsRepo = new InMemorySecretsRepository();
    secretsService = new SecretsService(secretsRepo, projectsRepo);

    orgRepo.orgs.push(mockOrg);
    projectsRepo.projects.push(mockProject);
    projectsRepo.environments.push(mockEnv);
    projectsRepo.environments.push(mockEnv2);
  });

  describe('Key Creation & Hashing', () => {
    it('creates a standard org-scoped API key successfully', async () => {
      const dto = { name: 'CI Key', scopes: ['secrets:read'] };
      const { apiKey, plainTextKey } = await apiKeysService.createKey(mockUser, 'org-1', dto);

      expect(apiKey).toBeDefined();
      expect(apiKey.name).toBe('CI Key');
      expect(apiKey.organizationId).toBe('org-1');
      expect(apiKey.projectId).toBeNull();
      expect(apiKey.environmentId).toBeNull();
      expect(apiKey.scopes).toEqual(['secrets:read']);
      expect(apiKey.isActive).toBe(true);

      // Plaintext must start with prefix and have entropy
      expect(plainTextKey).toMatch(/^sdv_sk_/);
      expect(apiKey.keyPrefix).toBe(plainTextKey.slice(0, 12));
      expect(apiKey.keyHash).toBeDefined();
      expect(apiKey.keyHash).not.toContain('sdv_sk_');
    });

    it('creates a project-scoped API key successfully', async () => {
      const dto = { name: 'Proj Key', scopes: ['secrets:read'], projectId: 'proj-1' };
      const { apiKey } = await apiKeysService.createKey(mockUser, 'org-1', dto);

      expect(apiKey.projectId).toBe('proj-1');
      expect(apiKey.environmentId).toBeNull();
    });

    it('creates an environment-scoped API key successfully', async () => {
      const dto = { 
        name: 'Env Key', 
        scopes: ['secrets:read'], 
        projectId: 'proj-1', 
        environmentId: 'env-1' 
      };
      const { apiKey } = await apiKeysService.createKey(mockUser, 'org-1', dto);

      expect(apiKey.projectId).toBe('proj-1');
      expect(apiKey.environmentId).toBe('env-1');
    });

    it('throws validation error if environment scope is passed without project scope', async () => {
      const dto = { 
        name: 'Invalid Scope Key', 
        scopes: ['secrets:read'], 
        environmentId: 'env-1' 
      };

      await expect(
        apiKeysService.createKey(mockUser, 'org-1', dto)
      ).rejects.toThrow(ValidationError);
    });

    it('throws forbidden error if non-admin tries to create API key', async () => {
      const regularUser = { id: 'user-2', role: 'member', orgId: 'org-1' };
      const dto = { name: 'CI Key', scopes: ['secrets:read'] };

      await expect(
        apiKeysService.createKey(regularUser, 'org-1', dto)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws forbidden error on organization mismatch', async () => {
      orgRepo.orgs.push({ id: 'org-other', slug: 'org-other', name: 'Other Org' });
      const dto = { name: 'CI Key', scopes: ['secrets:read'] };

      await expect(
        apiKeysService.createKey(mockUser, 'org-other', dto)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('Key Operations & Revocation', () => {
    it('lists keys for the organization', async () => {
      await apiKeysService.createKey(mockUser, 'org-1', { name: 'Key A', scopes: [] });
      await apiKeysService.createKey(mockUser, 'org-1', { name: 'Key B', scopes: [] });

      const keys = await apiKeysService.listKeys(mockUser, 'org-1');
      expect(keys.length).toBe(2);
      expect(keys[0]!.name).toBe('Key A');
      expect(keys[1]!.name).toBe('Key B');
    });

    it('gets key metadata', async () => {
      const { apiKey } = await apiKeysService.createKey(mockUser, 'org-1', { name: 'Key A', scopes: [] });
      
      const meta = await apiKeysService.getKeyMetadata(mockUser, apiKey.id);
      expect(meta.name).toBe('Key A');
    });

    it('deactivates/reactivates a key via updateKey', async () => {
      const { apiKey } = await apiKeysService.createKey(mockUser, 'org-1', { name: 'Key A', scopes: [] });
      
      let updated = await apiKeysService.updateKey(mockUser, apiKey.id, { isActive: false });
      expect(updated!.isActive).toBe(false);

      updated = await apiKeysService.updateKey(mockUser, apiKey.id, { isActive: true });
      expect(updated!.isActive).toBe(true);
    });

    it('revokes a key via deleteKey (sets isActive: false)', async () => {
      const { apiKey } = await apiKeysService.createKey(mockUser, 'org-1', { name: 'Key A', scopes: [] });
      
      await apiKeysService.deleteKey(mockUser, apiKey.id);
      const meta = await apiKeysService.getKeyMetadata(mockUser, apiKey.id);
      expect(meta.isActive).toBe(false);
    });
  });

  describe('Secrets API Key Scoping (Phase 4.4)', () => {
    const apiScopedUser = {
      id: 'user-1',
      role: 'admin',
      projectRole: 'admin',
      apiKeyProjectId: 'proj-1',
      apiKeyEnvironmentId: 'env-1',
    };

    it('allows secret actions when project and environment scopes match API Key boundaries', async () => {
      const secret = await secretsService.createSecret(
        apiScopedUser,
        'proj-1',
        'env-1',
        'API_URL',
        'https://api.seladev.com'
      );

      expect(secret).toBeDefined();
      expect(secret.key).toBe('API_URL');

      // List secrets
      const secrets = await secretsService.listSecrets(apiScopedUser, 'proj-1', 'env-1');
      expect(secrets.length).toBe(1);

      // Reveal secret
      const { plaintextValue } = await secretsService.revealSecret(apiScopedUser, 'proj-1', secret.id);
      expect(plaintextValue).toBe('https://api.seladev.com');

      // Update secret
      const updated = await secretsService.updateSecret(apiScopedUser, 'proj-1', secret.id, 'https://newapi.seladev.com');
      expect(updated).toBeDefined();

      // Delete secret
      await secretsService.deleteSecret(apiScopedUser, 'proj-1', secret.id);
      const remaining = await secretsService.listSecrets(apiScopedUser, 'proj-1', 'env-1');
      expect(remaining.length).toBe(0);
    });

    it('throws ForbiddenError when writing to a different project', async () => {
      await expect(
        secretsService.createSecret(
          apiScopedUser,
          'proj-other',
          'env-1',
          'API_URL',
          'https://api.seladev.com'
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when reading from a different project', async () => {
      await expect(
        secretsService.listSecrets(apiScopedUser, 'proj-other', 'env-1')
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when writing to a different environment', async () => {
      await expect(
        secretsService.createSecret(
          apiScopedUser,
          'proj-1',
          'env-2',
          'API_URL',
          'https://api.seladev.com'
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when reading from a different environment', async () => {
      await expect(
        secretsService.listSecrets(apiScopedUser, 'proj-1', 'env-2')
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
