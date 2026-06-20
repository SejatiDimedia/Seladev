import crypto from 'crypto';
import type { ApiKeysRepository } from './api-keys.repository';
import type { ProjectsRepository } from '../projects/projects.repository';
import type { OrganizationsRepository } from '../organizations/organizations.repository';
import { 
  NotFoundError, 
  ValidationError, 
  ForbiddenError 
} from '../../lib/errors';
import type { ApiKeyDocument } from '../../infrastructure/database/models/api-key.model';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes a buffer to base58 string.
 */
function toBase58(buffer: Buffer): string {
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // leading zeros
  for (let i = 0; i < buffer.length - 1 && buffer[i] === 0; i++) {
    digits.push(0);
  }

  return digits.reverse().map(digit => ALPHABET[digit]).join('');
}

export class ApiKeysService {
  constructor(
    private readonly apiKeysRepo: ApiKeysRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly orgRepo: OrganizationsRepository,
    private readonly auditLogsService?: AuditLogsService
  ) {}

  /**
   * Helper to generate a plaintext API key.
   */
  generatePlainTextKey(): string {
    const bytes = crypto.randomBytes(32);
    return `sdv_sk_${toBase58(bytes)}`;
  }

  private checkOrgAdmin(user: { orgId: string; role: string }) {
    if (user.role !== 'owner' && user.role !== 'admin') {
      throw new ForbiddenError('Only organization admins can manage API keys');
    }
  }

  async createKey(
    user: { id: string; role: string; projectRole?: string; orgId: string },
    orgIdOrSlug: string,
    dto: {
      name: string;
      scopes: string[];
      expiresInDays?: number | null | undefined;
      projectId?: string | null | undefined;
      environmentId?: string | null | undefined;
    },
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ apiKey: ApiKeyDocument; plainTextKey: string }> {
    // 1. Resolve organization by ID or Slug
    let org = await this.orgRepo.findOrgById(orgIdOrSlug);
    if (!org) {
      org = await this.orgRepo.findOrgBySlug(orgIdOrSlug);
    }
    if (!org) {
      throw new NotFoundError('Organization', orgIdOrSlug);
    }

    // Enforce that the user is creating a key in their own organization
    if (org.id !== user.orgId) {
      throw new ForbiddenError('Access denied: organization mismatch');
    }
    this.checkOrgAdmin(user);

    // 2. Validate projectId if provided
    if (dto.projectId) {
      const project = await this.projectsRepo.findProjectById(dto.projectId);
      if (!project || project.organizationId.toString() !== org.id) {
        throw new NotFoundError('Project', dto.projectId);
      }
    }

    // 3. Validate environmentId if provided
    if (dto.environmentId) {
      if (!dto.projectId) {
        throw new ValidationError([], 'Project ID is required when environment scoping is specified');
      }
      const env = await this.projectsRepo.findEnvironmentById(dto.environmentId);
      if (!env || env.projectId.toString() !== dto.projectId) {
        throw new NotFoundError('Environment', dto.environmentId);
      }
    }

    // 4. Compute expiresAt
    let expiresAt: Date | null = null;
    if (dto.expiresInDays !== undefined && dto.expiresInDays !== null) {
      expiresAt = new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000);
    }

    // 5. Generate raw key and SHA-256 hash
    const plainTextKey = this.generatePlainTextKey();
    const keyHash = crypto.createHash('sha256').update(plainTextKey).digest('hex');
    const prefix = plainTextKey.slice(0, 12); // 'sdv_sk_XXXXX'

    // 6. Create key
    const apiKey = await this.apiKeysRepo.createKey({
      name: dto.name,
      organizationId: org.id,
      projectId: dto.projectId || null,
      environmentId: dto.environmentId || null,
      userId: user.id,
      keyHash,
      keyPrefix: prefix,
      scopes: dto.scopes,
      expiresAt,
    });

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: org.id,
        projectId: dto.projectId || null,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'apiKey.created',
        resource: { type: 'apiKey', id: apiKey.id, name: apiKey.name },
        outcome: 'success',
        metadata: {
          scopes: apiKey.scopes,
          prefix: apiKey.keyPrefix,
          expiresAt: apiKey.expiresAt || null,
        },
      });
    }

    return { apiKey, plainTextKey };
  }

  async listKeys(
    user: { id: string; role: string; orgId: string },
    orgIdOrSlug: string
  ): Promise<ApiKeyDocument[]> {
    // Resolve organization
    let org = await this.orgRepo.findOrgById(orgIdOrSlug);
    if (!org) {
      org = await this.orgRepo.findOrgBySlug(orgIdOrSlug);
    }
    if (!org) {
      throw new NotFoundError('Organization', orgIdOrSlug);
    }

    if (org.id !== user.orgId) {
      throw new ForbiddenError('Access denied: organization mismatch');
    }
    this.checkOrgAdmin(user);

    return this.apiKeysRepo.listKeysByOrg(org.id);
  }

  async getKeyMetadata(
    user: { id: string; role: string; orgId: string },
    keyId: string
  ): Promise<ApiKeyDocument> {
    this.checkOrgAdmin(user);
    const key = await this.apiKeysRepo.findKeyById(keyId);
    if (!key) {
      throw new NotFoundError('API Key', keyId);
    }

    if (key.organizationId.toString() !== user.orgId) {
      throw new ForbiddenError('Access denied: organization mismatch');
    }

    return key;
  }

  async updateKey(
    user: { id: string; role: string; orgId: string },
    keyId: string,
    dto: { isActive: boolean },
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<ApiKeyDocument> {
    this.checkOrgAdmin(user);
    const key = await this.apiKeysRepo.findKeyById(keyId);
    if (!key) {
      throw new NotFoundError('API Key', keyId);
    }

    if (key.organizationId.toString() !== user.orgId) {
      throw new ForbiddenError('Access denied: organization mismatch');
    }

    const wasActive = key.isActive;
    key.isActive = dto.isActive;
    await key.save();

    if (this.auditLogsService) {
      const action = !dto.isActive && wasActive ? 'apiKey.revoked' : 'apiKey.updated';
      this.auditLogsService.record({
        organizationId: key.organizationId.toString(),
        projectId: key.projectId ? key.projectId.toString() : null,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action,
        resource: { type: 'apiKey', id: key.id, name: key.name },
        outcome: 'success',
        metadata: { isActive: key.isActive },
      });
    }

    return key;
  }

  async deleteKey(
    user: { id: string; role: string; orgId: string },
    keyId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<void> {
    this.checkOrgAdmin(user);
    const key = await this.apiKeysRepo.findKeyById(keyId);
    if (!key) {
      throw new NotFoundError('API Key', keyId);
    }

    if (key.organizationId.toString() !== user.orgId) {
      throw new ForbiddenError('Access denied: organization mismatch');
    }

    // Revoke key (sets isActive: false) as per spec
    key.isActive = false;
    await key.save();

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: key.organizationId.toString(),
        projectId: key.projectId ? key.projectId.toString() : null,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'apiKey.revoked',
        resource: { type: 'apiKey', id: key.id, name: key.name },
        outcome: 'success',
        metadata: { revokedByDelete: true },
      });
    }
  }
}
