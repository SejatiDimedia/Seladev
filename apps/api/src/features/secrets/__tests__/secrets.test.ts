import { describe, it, expect, beforeEach } from 'vitest';
import { SecretsService } from '../secrets.service';
import type { SecretsRepository } from '../secrets.repository';
import type { ProjectsRepository } from '../../projects/projects.repository';
import { ConflictError, ForbiddenError } from '../../../lib/errors';


// Mock helpers for Mongoose documents
function createMockSecretDoc(data: any) {
  const doc = {
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
    isLocked: data.isLocked || false,
    createdBy: data.createdBy,
    lastAccessedAt: data.lastAccessedAt || null,
    expiresAt: data.expiresAt || null,
    save: async function() { return this; },
    toJSON: function() {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        projectId: this.projectId.toString(),
        environmentId: this.environmentId.toString(),
        key: this.key,
        version: this.version,
        isLocked: this.isLocked,
        createdBy: this.createdBy.toString(),
        lastAccessedAt: this.lastAccessedAt ? this.lastAccessedAt.toISOString() : null,
        expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
      };
    }
  };
  return doc as any;
}

function createMockSecretVersionDoc(data: any) {
  const doc = {
    id: data.id || 'sv-123',
    _id: data.id || 'sv-123',
    secretId: data.secretId,
    organizationId: data.organizationId,
    encryptedValue: data.encryptedValue,
    iv: data.iv,
    authTag: data.authTag,
    keyVersion: data.keyVersion || 1,
    version: data.version,
    createdBy: data.createdBy,
    createdAt: new Date(),
    toJSON: function() {
      return {
        id: this.id,
        secretId: this.secretId.toString(),
        organizationId: this.organizationId.toString(),
        version: this.version,
        createdBy: this.createdBy.toString(),
        createdAt: this.createdAt.toISOString(),
      };
    }
  };
  return doc as any;
}

class InMemorySecretsRepository implements SecretsRepository {
  public secrets: any[] = [];
  public versions: any[] = [];

  async findSecretById(id: string): Promise<any | null> {
    const s = this.secrets.find(x => x.id === id);
    return s || null;
  }

  async findSecretByKey(environmentId: string, key: string): Promise<any | null> {
    const s = this.secrets.find(x => x.environmentId === environmentId && x.key === key.toUpperCase());
    return s || null;
  }

  async createSecret(data: any): Promise<any> {
    const secret = createMockSecretDoc({
      ...data,
      id: `secret-${this.secrets.length + 1}`,
    });
    this.secrets.push(secret);
    return secret;
  }

  async updateSecret(id: string, update: Partial<any>): Promise<any | null> {
    const secret = await this.findSecretById(id);
    if (!secret) return null;
    Object.assign(secret, update);
    return secret;
  }

  async deleteSecret(id: string): Promise<boolean> {
    const len = this.secrets.length;
    this.secrets = this.secrets.filter(x => x.id !== id);
    return this.secrets.length < len;
  }

  async listSecretsByEnv(environmentId: string): Promise<any[]> {
    return this.secrets.filter(x => x.environmentId === environmentId);
  }

  async createSecretVersion(data: any): Promise<any> {
    const sv = createMockSecretVersionDoc({
      ...data,
      id: `sv-${this.versions.length + 1}`,
    });
    this.versions.push(sv);
    return sv;
  }

  async findSecretVersionById(id: string): Promise<any | null> {
    const sv = this.versions.find(x => x.id === id);
    return sv || null;
  }

  async listSecretVersions(secretId: string): Promise<any[]> {
    return this.versions.filter(x => x.secretId === secretId).sort((a, b) => b.version - a.version);
  }

  async deleteSecretVersions(secretId: string): Promise<boolean> {
    this.versions = this.versions.filter(x => x.secretId !== secretId);
    return true;
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

  // Not strictly used by service but required for signature compliance
  async findProjectBySlug(_orgId: string, _slug: string): Promise<any | null> { return null; }
  async createProject(_data: any): Promise<any> { return null; }
  async updateProject(_id: string, _update: Partial<any>): Promise<any | null> { return null; }
  async listProjectsByOrg(_orgId: string): Promise<any[]> { return []; }
  async createEnvironment(_data: any): Promise<any> { return null; }
  async findEnvironmentBySlug(_projectId: string, _slug: string): Promise<any | null> { return null; }
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

describe('Secrets and Versioning Module Tests', () => {
  let secretsRepo: InMemorySecretsRepository;
  let projectsRepo: InMemoryProjectsRepository;
  let secretsService: SecretsService;

  const mockOrgId = 'org-789';
  const mockProjectId = 'project-456';
  const mockDevEnvId = 'env-dev';
  const mockProdEnvId = 'env-prod';
  const mockUserId = 'user-123';

  // Users
  const developerUser = { id: mockUserId, role: 'member', projectRole: 'developer' };
  const adminUser = { id: 'admin-user', role: 'member', projectRole: 'admin' };

  beforeEach(() => {
    secretsRepo = new InMemorySecretsRepository();
    projectsRepo = new InMemoryProjectsRepository();
    secretsService = new SecretsService(secretsRepo, projectsRepo);

    // Setup project
    projectsRepo.projects.push({
      id: mockProjectId,
      organizationId: mockOrgId,
      name: 'Seladev Core',
      settings: { maxProjects: 3 },
    });

    // Setup development environment (standard)
    projectsRepo.environments.push({
      id: mockDevEnvId,
      projectId: mockProjectId,
      organizationId: mockOrgId,
      name: 'development',
      isProtected: false,
    });

    // Setup production environment (protected)
    projectsRepo.environments.push({
      id: mockProdEnvId,
      projectId: mockProjectId,
      organizationId: mockOrgId,
      name: 'production',
      isProtected: true,
    });
  });

  describe('Secret Creation', () => {
    it('should create secret and its initial version in standard environment', async () => {
      const secret = await secretsService.createSecret(
        developerUser,
        mockProjectId,
        mockDevEnvId,
        'DATABASE_URL',
        'postgres://localhost:5432/dev'
      );

      expect(secret.key).toBe('DATABASE_URL');
      expect(secret.version).toBe(1);
      expect(secret.encryptedValue).toBeDefined();

      // Check version was created
      const versions = await secretsRepo.listSecretVersions(secret.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
    });

    it('should fail creation if key already exists in same environment', async () => {
      await secretsService.createSecret(
        developerUser,
        mockProjectId,
        mockDevEnvId,
        'DATABASE_URL',
        'first-val'
      );

      await expect(
        secretsService.createSecret(
          developerUser,
          mockProjectId,
          mockDevEnvId,
          'DATABASE_URL',
          'second-val'
        )
      ).rejects.toThrow(ConflictError);
    });

    it('should allow project admin to create secret in protected environment', async () => {
      const secret = await secretsService.createSecret(
        adminUser,
        mockProjectId,
        mockProdEnvId,
        'PROD_KEY',
        'prod-secret-value'
      );

      expect(secret.key).toBe('PROD_KEY');
    });

    it('should prevent developer from creating secret in protected environment', async () => {
      await expect(
        secretsService.createSecret(
          developerUser,
          mockProjectId,
          mockProdEnvId,
          'PROD_KEY',
          'prod-secret-value'
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('Secret Listing', () => {
    beforeEach(async () => {
      await secretsService.createSecret(developerUser, mockProjectId, mockDevEnvId, 'DB_PASS', 'foo');
      await secretsService.createSecret(adminUser, mockProjectId, mockProdEnvId, 'PROD_DB_PASS', 'bar');
    });

    it('should return list of secrets in standard environment', async () => {
      const secrets = await secretsService.listSecrets(developerUser, mockProjectId, mockDevEnvId);
      expect(secrets).toHaveLength(1);
      expect(secrets[0]!.key).toBe('DB_PASS');
      // Assert that calling toJSON() hides cipher details
      const json = secrets[0]!.toJSON();
      expect(json.encryptedValue).toBeUndefined();
      expect(json.iv).toBeUndefined();
    });

    it('should allow developer to list secrets in protected environment (metadata only)', async () => {
      const secrets = await secretsService.listSecrets(developerUser, mockProjectId, mockProdEnvId);
      expect(secrets).toHaveLength(1);
      expect(secrets[0]!.key).toBe('PROD_DB_PASS');
    });
  });

  describe('Secret Decryption & Reveal', () => {
    let devSecret: any;
    let prodSecret: any;

    beforeEach(async () => {
      devSecret = await secretsService.createSecret(developerUser, mockProjectId, mockDevEnvId, 'DB_PASS', 'dev-pass-123');
      prodSecret = await secretsService.createSecret(adminUser, mockProjectId, mockProdEnvId, 'PROD_DB_PASS', 'prod-pass-456');
    });

    it('should reveal secret value in standard environment for developer', async () => {
      const { secret, plaintextValue } = await secretsService.revealSecret(developerUser, mockProjectId, devSecret.id);
      expect(plaintextValue).toBe('dev-pass-123');
      expect(secret.lastAccessedAt).not.toBeNull();
    });

    it('should prevent developer from revealing secret value in protected environment', async () => {
      await expect(
        secretsService.revealSecret(developerUser, mockProjectId, prodSecret.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow project admin to reveal secret value in protected environment', async () => {
      const { plaintextValue } = await secretsService.revealSecret(adminUser, mockProjectId, prodSecret.id);
      expect(plaintextValue).toBe('prod-pass-456');
    });
  });

  describe('Secret Update & Versioning', () => {
    let secret: any;

    beforeEach(async () => {
      secret = await secretsService.createSecret(developerUser, mockProjectId, mockDevEnvId, 'DB_PASS', 'old-val');
    });

    it('should update secret, increment version, and keep history in standard environment', async () => {
      const updated = await secretsService.updateSecret(developerUser, mockProjectId, secret.id, 'new-val');
      expect(updated.version).toBe(2);

      const { plaintextValue } = await secretsService.revealSecret(developerUser, mockProjectId, secret.id);
      expect(plaintextValue).toBe('new-val');

      // Verify version history has 2 records
      const versions = await secretsService.listSecretVersions(developerUser, mockProjectId, secret.id);
      expect(versions).toHaveLength(2);
      expect(versions[0]!.version).toBe(2);
      expect(versions[1]!.version).toBe(1);
    });

    it('should prevent developer from updating secrets in protected environments', async () => {
      const pSecret = await secretsService.createSecret(adminUser, mockProjectId, mockProdEnvId, 'PROD_VAL', 'old');
      await expect(
        secretsService.updateSecret(developerUser, mockProjectId, pSecret.id, 'new')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('Secret Rollback', () => {
    let secret: any;

    beforeEach(async () => {
      secret = await secretsService.createSecret(developerUser, mockProjectId, mockDevEnvId, 'DB_PASS', 'version-1');
      await secretsService.updateSecret(developerUser, mockProjectId, secret.id, 'version-2');
      await secretsService.updateSecret(developerUser, mockProjectId, secret.id, 'version-3');
    });

    it('should rollback to version 1 successfully, creating a new version 4', async () => {
      const rolledBack = await secretsService.rollbackSecret(developerUser, mockProjectId, secret.id, 1);
      expect(rolledBack.version).toBe(4);

      const { plaintextValue } = await secretsService.revealSecret(developerUser, mockProjectId, secret.id);
      expect(plaintextValue).toBe('version-1');

      // History should have 4 records now, newest (v4) having the same value as v1
      const versions = await secretsService.listSecretVersions(developerUser, mockProjectId, secret.id);
      expect(versions).toHaveLength(4);
      expect(versions[0]!.version).toBe(4);
      expect(versions[3]!.version).toBe(1);
    });

    it('should prevent developer from rolling back secrets in protected environments', async () => {
      const pSecret = await secretsService.createSecret(adminUser, mockProjectId, mockProdEnvId, 'PROD_VAL', 'v1');
      await secretsService.updateSecret(adminUser, mockProjectId, pSecret.id, 'v2');

      await expect(
        secretsService.rollbackSecret(developerUser, mockProjectId, pSecret.id, 1)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('Secret Deletion', () => {
    let secret: any;

    beforeEach(async () => {
      secret = await secretsService.createSecret(developerUser, mockProjectId, mockDevEnvId, 'DB_PASS', 'foo');
      await secretsService.updateSecret(developerUser, mockProjectId, secret.id, 'bar');
    });

    it('should delete secret and cascade delete its versions', async () => {
      await secretsService.deleteSecret(developerUser, mockProjectId, secret.id);

      const found = await secretsRepo.findSecretById(secret.id);
      expect(found).toBeNull();

      const versions = await secretsRepo.listSecretVersions(secret.id);
      expect(versions).toHaveLength(0);
    });

    it('should prevent developer from deleting secrets in protected environments', async () => {
      const pSecret = await secretsService.createSecret(adminUser, mockProjectId, mockProdEnvId, 'PROD_VAL', 'v1');

      await expect(
        secretsService.deleteSecret(developerUser, mockProjectId, pSecret.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
