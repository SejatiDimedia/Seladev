import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { SsoService } from '../sso.service';
import type { SsoRepository } from '../sso.types';
import { decryptGcm } from '../../../lib/crypto';
import jwt from 'jsonwebtoken';

// 1. Mock Redis Client
const mockRedisSet = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();

vi.mock('../../../config/redis', () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
  }),
}));

// 2. Mock Audit Logs Service
const mockAuditRecord = vi.fn().mockResolvedValue(undefined);
const mockAuditLogsService = {
  record: mockAuditRecord,
} as any;

// 3. Mock global fetch (for OIDC token exchanges)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// 4. Mock Mongoose Models
// Since we want to test database queries and JIT provisioning against mocked collections:
const mockOrgFindOne = vi.fn();
const mockUserFindOne = vi.fn();
const mockUserCreate = vi.fn();
const mockMembershipFindOne = vi.fn();
const mockMembershipCreate = vi.fn();
const mockRefreshTokenCreate = vi.fn();

vi.mock('../../../infrastructure/database/models/organization.model', () => ({
  OrganizationModel: {
    findOne: (query: any) => ({
      exec: async () => mockOrgFindOne(query),
    }),
  },
}));

vi.mock('../../../infrastructure/database/models/user.model', () => ({
  UserModel: {
    findOne: (query: any) => ({
      exec: async () => mockUserFindOne(query),
    }),
    create: (data: any) => {
      const userDoc = {
        _id: new mongoose.Types.ObjectId(),
        id: 'new-jit-user',
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        isActive: true,
        save: async () => userDoc,
        toJSON: () => userDoc,
      };
      mockUserCreate(data);
      return userDoc;
    },
  },
}));

vi.mock('../../../infrastructure/database/models/membership.model', () => ({
  MembershipModel: {
    findOne: (query: any) => ({
      exec: async () => mockMembershipFindOne(query),
    }),
    create: (data: any) => {
      const memberDoc = {
        organizationId: data.organizationId,
        userId: data.userId,
        role: data.role,
        status: data.status,
        save: async () => memberDoc,
      };
      mockMembershipCreate(data);
      return memberDoc;
    },
  },
}));

vi.mock('../../../infrastructure/database/models/refresh-token.model', () => ({
  RefreshTokenModel: {
    create: async (data: any) => {
      mockRefreshTokenCreate(data);
      return data;
    },
  },
}));

vi.mock('mongoose', async () => {
  const actual = await vi.importActual<typeof import('mongoose')>('mongoose');
  return {
    ...actual,
    model: (name: string) => {
      if (name === 'Organization') {
        return {
          findOne: (query: any) => ({
            exec: async () => mockOrgFindOne(query),
          }),
        };
      }
      if (name === 'SsoConfig') {
        return {
          findOne: (query: any) => ({
            exec: async () => {
              // Simulating sso lookup
              const orgId = query.organizationId;
              if (orgId && orgId.toString() === '60d5ec386f6e520015b67d5e') {
                return {
                  isActive: true,
                  provider: 'saml',
                };
              }
              return null;
            },
          }),
        };
      }
      return actual.model(name);
    },
  };
});

// 5. InMemory SsoRepository
function createMockSsoConfigDoc(data: any) {
  const doc = {
    _id: data._id || data.id || 'sso-123',
    id: data.id || 'sso-123',
    organizationId: data.organizationId,
    provider: data.provider,
    isActive: data.isActive !== undefined ? data.isActive : true,

    samlEntryPointCiphertext: data.samlEntryPointCiphertext || null,
    samlEntryPointIv: data.samlEntryPointIv || null,
    samlEntryPointAuthTag: data.samlEntryPointAuthTag || null,
    samlIssuerCiphertext: data.samlIssuerCiphertext || null,
    samlIssuerIv: data.samlIssuerIv || null,
    samlIssuerAuthTag: data.samlIssuerAuthTag || null,
    samlCertCiphertext: data.samlCertCiphertext || null,
    samlCertIv: data.samlCertIv || null,
    samlCertAuthTag: data.samlCertAuthTag || null,

    oidcClientIdCiphertext: data.oidcClientIdCiphertext || null,
    oidcClientIdIv: data.oidcClientIdIv || null,
    oidcClientIdAuthTag: data.oidcClientIdAuthTag || null,
    oidcClientSecretCiphertext: data.oidcClientSecretCiphertext || null,
    oidcClientSecretIv: data.oidcClientSecretIv || null,
    oidcClientSecretAuthTag: data.oidcClientSecretAuthTag || null,
    oidcIssuerCiphertext: data.oidcIssuerCiphertext || null,
    oidcIssuerIv: data.oidcIssuerIv || null,
    oidcIssuerAuthTag: data.oidcIssuerAuthTag || null,

    save: async function () { return this; },
    toJSON: function () {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        provider: this.provider,
        isActive: this.isActive,
      };
    },
  };
  return doc as any;
}

class InMemorySsoRepository implements SsoRepository {
  public configs: any[] = [];

  async findConfigByOrgId(orgId: string): Promise<any | null> {
    return this.configs.find(c => c.organizationId === orgId) || null;
  }

  async createConfig(orgId: string, data: any): Promise<any> {
    const config = createMockSsoConfigDoc({
      ...data,
      id: `sso-${this.configs.length + 1}`,
      organizationId: orgId,
    });
    this.configs.push(config);
    return config;
  }

  async updateConfig(orgId: string, update: Partial<any>): Promise<any | null> {
    const config = await this.findConfigByOrgId(orgId);
    if (!config) return null;
    Object.assign(config, update);
    return config;
  }

  async deleteConfig(orgId: string): Promise<boolean> {
    const len = this.configs.length;
    this.configs = this.configs.filter(c => c.organizationId !== orgId);
    return this.configs.length < len;
  }
}

describe('SSO / SAML & OIDC Slice', () => {
  let ssoRepo: InMemorySsoRepository;
  let service: SsoService;
  const orgId = '60d5ec386f6e520015b67d5e';
  const userId = '60d5ec386f6e520015b67d5f';

  beforeEach(() => {
    vi.clearAllMocks();
    ssoRepo = new InMemorySsoRepository();
    service = new SsoService(ssoRepo, mockAuditLogsService);
  });

  describe('SSO Configuration CRUD', () => {
    it('should create SAML configuration with encrypted attributes', async () => {
      const result = await service.createSsoConfig(orgId, userId, {
        provider: 'saml',
        samlEntryPoint: 'https://idp.example.com/sso',
        samlIssuer: 'seladev-issuer',
        samlCert: 'my-public-cert-content-here',
      });

      expect(result.id).toBeDefined();
      expect(result.provider).toBe('saml');
      expect(ssoRepo.configs).toHaveLength(1);

      const dbConfig = ssoRepo.configs[0];
      expect(dbConfig.samlEntryPointCiphertext).toBeDefined();
      expect(dbConfig.samlEntryPointIv).toBeDefined();
      expect(dbConfig.samlEntryPointAuthTag).toBeDefined();

      // Decrypt and verify GCM
      const decryptedEntryPoint = decryptGcm({
        ciphertext: dbConfig.samlEntryPointCiphertext,
        iv: dbConfig.samlEntryPointIv,
        authTag: dbConfig.samlEntryPointAuthTag,
      }, orgId);
      expect(decryptedEntryPoint).toBe('https://idp.example.com/sso');

      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sso.config_created',
          organizationId: orgId,
        })
      );
    });

    it('should create OIDC configuration with encrypted attributes', async () => {
      const result = await service.createSsoConfig(orgId, userId, {
        provider: 'oidc',
        oidcClientId: 'client-id-xyz',
        oidcClientSecret: 'super-secret-key',
        oidcIssuer: 'https://accounts.google.com',
      });

      expect(result.id).toBeDefined();
      expect(result.provider).toBe('oidc');

      const dbConfig = ssoRepo.configs[0];
      const decryptedSecret = decryptGcm({
        ciphertext: dbConfig.oidcClientSecretCiphertext,
        iv: dbConfig.oidcClientSecretIv,
        authTag: dbConfig.oidcClientSecretAuthTag,
      }, orgId);
      expect(decryptedSecret).toBe('super-secret-key');
    });

    it('should get sso config and update it', async () => {
      await service.createSsoConfig(orgId, userId, {
        provider: 'saml',
        samlEntryPoint: 'https://idp.example.com/sso',
        samlIssuer: 'seladev-issuer',
        samlCert: 'cert',
      });

      const config = await service.getSsoConfig(orgId);
      expect(config.provider).toBe('saml');

      const updated = await service.updateSsoConfig(orgId, userId, {
        isActive: false,
        samlEntryPoint: 'https://new-idp.com',
      });

      expect(updated.isActive).toBe(false);
      const decrypted = decryptGcm({
        ciphertext: updated.samlEntryPointCiphertext!,
        iv: updated.samlEntryPointIv!,
        authTag: updated.samlEntryPointAuthTag!,
      }, orgId);
      expect(decrypted).toBe('https://new-idp.com');
    });
  });

  describe('SSO Discovery & Redirections', () => {
    it('should discover SSO by email domain', async () => {
      // Mock Organization return matching settings.allowedDomains
      mockOrgFindOne.mockResolvedValue({
        id: orgId,
        _id: new mongoose.Types.ObjectId(orgId),
        name: 'Acme Corp',
        settings: { allowedDomains: ['acme.com'] },
      });

      // Insert active SAML config
      await service.createSsoConfig(orgId, userId, {
        provider: 'saml',
        samlEntryPoint: 'https://idp.acme.com',
        samlIssuer: 'acme-issuer',
        samlCert: 'cert',
      });

      const discovery = await service.discoverSso('employee@acme.com');
      expect(discovery.ssoEnabled).toBe(true);
      expect(discovery.provider).toBe('saml');
      expect(discovery.orgId).toBe(orgId);
    });

    it('should discover SSO by organization slug', async () => {
      mockOrgFindOne.mockResolvedValue({
        id: orgId,
        _id: new mongoose.Types.ObjectId(orgId),
        name: 'Acme Corp',
        slug: 'acme',
      });

      await service.createSsoConfig(orgId, userId, {
        provider: 'oidc',
        oidcClientId: 'id',
        oidcClientSecret: 'sec',
        oidcIssuer: 'https://idp.com',
      });

      const discovery = await service.discoverSso('acme');
      expect(discovery.ssoEnabled).toBe(true);
      expect(discovery.provider).toBe('oidc');
    });

    it('should return ssoEnabled false if not configured', async () => {
      mockOrgFindOne.mockResolvedValue(null);
      const discovery = await service.discoverSso('non-existent');
      expect(discovery.ssoEnabled).toBe(false);
    });

    it('should initiate OIDC login redirect and set state in Redis', async () => {
      await service.createSsoConfig(orgId, userId, {
        provider: 'oidc',
        oidcClientId: 'client-123',
        oidcClientSecret: 'secret-123',
        oidcIssuer: 'https://accounts.google.com',
      });

      const redirectUrl = await service.initiateOidcLogin(orgId);
      expect(redirectUrl).toContain('https://accounts.google.com/authorize');
      expect(redirectUrl).toContain('client_id=client-123');
      expect(redirectUrl).toContain('state=');

      // Verify Redis state set
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^sso:state:/),
        orgId,
        { EX: 900 }
      );
    });
  });

  describe('SSO Authentication Callbacks & JIT Provisioning', () => {
    const oidcOrgId = '60d5ec386f6e520015b67d50';

    beforeEach(async () => {
      await service.createSsoConfig(orgId, userId, {
        provider: 'saml',
        samlEntryPoint: 'https://idp.acme.com',
        samlIssuer: 'acme-issuer',
        samlCert: 'cert',
      });

      await service.createSsoConfig(oidcOrgId, userId, {
        provider: 'oidc',
        oidcClientId: 'client-123',
        oidcClientSecret: 'secret-123',
        oidcIssuer: 'https://accounts.google.com',
      });
    });

    it('should handle OIDC Callback successfully, do JIT user provisioning and membership', async () => {
      const state = 'state-xyz-123';
      const code = 'auth-code-123';

      mockRedisGet.mockResolvedValue(oidcOrgId); // valid state returns oidcOrgId
      
      // Mock fetch Google Token Endpoint returning ID Token
      const mockIdToken = jwt.sign(
        {
          email: 'jit-user@acme.com',
          given_name: 'John',
          family_name: 'Doe',
        },
        'dummy-key'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id_token: mockIdToken }),
      });

      // Mock user not existing initially (triggers JIT creation)
      mockUserFindOne.mockResolvedValue(null);
      // Mock membership not existing (triggers JIT membership)
      mockMembershipFindOne.mockResolvedValue(null);

      const loginResult = await service.handleOidcCallback(code, state);

      expect(loginResult.accessToken).toBeDefined();
      expect(loginResult.refreshToken).toBeDefined();

      // User created
      expect(mockUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jit-user@acme.com',
          firstName: 'John',
          lastName: 'Doe',
        })
      );

      // Membership created as active member
      expect(mockMembershipCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: new mongoose.Types.ObjectId(oidcOrgId),
          role: 'member',
          status: 'active',
        })
      );

      // Refresh token recorded
      expect(mockRefreshTokenCreate).toHaveBeenCalled();
    });

    it('should handle SAML Callback, bypass JIT if user already exists', async () => {
      // Mock user existing
      const existingUser = {
        _id: new mongoose.Types.ObjectId(),
        id: 'user-777',
        email: 'existing-user@acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
        isActive: true,
        save: vi.fn(),
        toJSON: () => ({ id: 'user-777', email: 'existing-user@acme.com' }),
      };
      mockUserFindOne.mockResolvedValue(existingUser);

      // Mock active member membership existing
      mockMembershipFindOne.mockResolvedValue({
        organizationId: new mongoose.Types.ObjectId(orgId),
        userId: existingUser._id,
        role: 'admin',
        status: 'active',
      });

      // Stub parseAndVerifySaml to bypass samlify parsing in unit test environment
      const verifySamlSpy = vi.spyOn(service, 'parseAndVerifySaml').mockResolvedValue({
        email: 'existing-user@acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const response = await service.handleSamlCallback(orgId, 'dummy-saml-response-b64');

      expect(response.accessToken).toBeDefined();
      expect(response.user.id).toBe('user-777');
      expect(mockUserCreate).not.toHaveBeenCalled(); // No JIT user creation since they existed

      verifySamlSpy.mockRestore();
    });
  });
});
