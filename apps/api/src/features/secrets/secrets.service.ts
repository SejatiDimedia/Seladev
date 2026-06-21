import type { SecretsRepository } from './secrets.repository';
import type { ProjectsRepository } from '../projects/projects.repository';
import { 
  ConflictError, 
  NotFoundError, 
  ForbiddenError 
} from '../../lib/errors';
import { encryptGcm, decryptGcm } from '../../lib/crypto';
import type { SecretDocument } from '../../infrastructure/database/models/secret.model';
import type { SecretVersionDocument } from '../../infrastructure/database/models/secret-version.model';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';

export interface SecretsUser {
  id: string;
  email?: string;
  role: string;
  orgId?: string;
  projectRole?: string;
  apiKeyProjectId?: string | null;
  apiKeyEnvironmentId?: string | null;
}

export class SecretsService {
  constructor(
    private readonly secretsRepo: SecretsRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly auditLogsService?: AuditLogsService,
    private readonly webhookPublisher?: any
  ) {}

  /**
   * Helper to enforce API key project and environment boundaries.
   */
  private enforceApiKeyScoping(
    user: SecretsUser,
    projectId: string,
    environmentId: string
  ): void {
    if (user.apiKeyProjectId && user.apiKeyProjectId !== projectId) {
      throw new ForbiddenError('API key is scoped to a different project');
    }
    if (user.apiKeyEnvironmentId && user.apiKeyEnvironmentId !== environmentId) {
      throw new ForbiddenError('API key is scoped to a different environment');
    }
  }

  /**
   * Helper to check access for reading/revealing secrets.
   */
  private async checkReadAccess(
    user: SecretsUser,
    environmentId: string
  ): Promise<void> {
    const env = await this.projectsRepo.findEnvironmentById(environmentId);
    if (!env) {
      throw new NotFoundError('Environment', environmentId);
    }

    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    const isProjAdmin = user.projectRole === 'admin';
    const isDeveloper = user.projectRole === 'developer';

    if (env.isProtected) {
      // In protected environments (e.g. production), only project admins and org admins/owners can reveal secrets
      if (!isOrgAdmin && !isProjAdmin) {
        throw new ForbiddenError('Only project admins can reveal secrets in protected environments');
      }
    } else {
      // In standard environments, project developers are also allowed
      if (!isOrgAdmin && !isProjAdmin && !isDeveloper) {
        throw new ForbiddenError('You do not have permission to reveal secrets in this environment');
      }
    }
  }

  /**
   * Helper to check access for writing (create/update/delete/rollback) secrets.
   */
  private async checkWriteAccess(
    user: SecretsUser,
    environmentId: string
  ): Promise<void> {
    const env = await this.projectsRepo.findEnvironmentById(environmentId);
    if (!env) {
      throw new NotFoundError('Environment', environmentId);
    }

    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    const isProjAdmin = user.projectRole === 'admin';
    const isDeveloper = user.projectRole === 'developer';

    if (env.isProtected) {
      // In protected environments, only project admins and org admins/owners can modify secrets
      if (!isOrgAdmin && !isProjAdmin) {
        throw new ForbiddenError('Only project admins can write secrets in protected environments');
      }
    } else {
      // In standard environments, project developers are allowed
      if (!isOrgAdmin && !isProjAdmin && !isDeveloper) {
        throw new ForbiddenError('You do not have permission to write secrets in this environment');
      }
    }
  }

  async createSecret(
    user: SecretsUser,
    projectId: string,
    environmentId: string,
    key: string,
    value: string,
    expiresAt?: Date | null,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<SecretDocument> {
    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, environmentId);

    // 1. Verify project exists
    const project = await this.projectsRepo.findProjectById(projectId);
    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    // 2. Verify environment exists and belongs to the project
    const env = await this.projectsRepo.findEnvironmentById(environmentId);
    if (!env || env.projectId.toString() !== projectId) {
      throw new NotFoundError('Environment', environmentId);
    }

    // 3. Enforce write access control
    await this.checkWriteAccess(user, environmentId);

    // 4. Validate unique key name in environment
    const upperKey = key.toUpperCase();
    const existing = await this.secretsRepo.findSecretByKey(environmentId, upperKey);
    if (existing) {
      throw new ConflictError(`Secret with key "${upperKey}" already exists in this environment`);
    }

    // 5. Encrypt secret
    const orgId = project.organizationId.toString();
    const payload = encryptGcm(value, orgId);

    // 6. Create secret document
    const secret = await this.secretsRepo.createSecret({
      organizationId: orgId,
      projectId,
      environmentId,
      key: upperKey,
      encryptedValue: payload.ciphertext,
      iv: payload.iv,
      authTag: payload.authTag,
      keyVersion: 1,
      createdBy: user.id,
      expiresAt: expiresAt || null,
    });

    // 7. Create secret version document (Phase 2.3 version history)
    await this.secretsRepo.createSecretVersion({
      secretId: secret.id,
      organizationId: orgId,
      encryptedValue: payload.ciphertext,
      iv: payload.iv,
      authTag: payload.authTag,
      keyVersion: 1,
      version: 1,
      createdBy: user.id,
    });

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: orgId,
        projectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'secret.created',
        resource: { type: 'secret', id: secret.id, name: secret.key },
        outcome: 'success',
        metadata: {
          environmentId,
          expiresAt: expiresAt || null,
          apiKeyId: (user as any).apiKeyId || null,
        },
      });
    }

    if (this.webhookPublisher) {
      this.webhookPublisher.publish('secret.created', orgId, projectId, {
        secret: {
          id: secret.id,
          key: secret.key,
          environmentId,
          createdBy: {
            userId: user.id,
            email: user.email || '',
          },
        },
      }).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

    return secret;
  }

  async listSecrets(
    user: SecretsUser,
    projectId: string,
    environmentId: string
  ): Promise<SecretDocument[]> {
    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, environmentId);

    // 1. Verify environment exists and belongs to project
    const env = await this.projectsRepo.findEnvironmentById(environmentId);
    if (!env || env.projectId.toString() !== projectId) {
      throw new NotFoundError('Environment', environmentId);
    }

    // 2. List secrets metadata (no permission check needed beyond standard rbac router middleware)
    return this.secretsRepo.listSecretsByEnv(environmentId);
  }

  async getSecretMetadata(
    user: SecretsUser,
    projectId: string,
    secretId: string
  ): Promise<SecretDocument> {
    const secret = await this.secretsRepo.findSecretById(secretId);
    if (!secret || secret.projectId.toString() !== projectId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, secret.environmentId.toString());

    return secret;
  }

  async revealSecret(
    user: SecretsUser,
    projectId: string,
    secretId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ secret: SecretDocument; plaintextValue: string }> {
    const secret = await this.secretsRepo.findSecretById(secretId);
    if (!secret || secret.projectId.toString() !== projectId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, secret.environmentId.toString());

    // Enforce read access (reveal) control
    await this.checkReadAccess(user, secret.environmentId.toString());

    // Decrypt GCM payload
    const plaintextValue = decryptGcm(
      {
        ciphertext: secret.encryptedValue,
        iv: secret.iv,
        authTag: secret.authTag,
      },
      secret.organizationId.toString()
    );

    // Update last accessed
    secret.lastAccessedAt = new Date();
    await secret.save();

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: secret.organizationId.toString(),
        projectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'secret.revealed',
        resource: { type: 'secret', id: secret.id, name: secret.key },
        outcome: 'success',
        metadata: {
          environmentId: secret.environmentId.toString(),
          apiKeyId: (user as any).apiKeyId || null,
        },
      });
    }

    return { secret, plaintextValue };
  }

  async updateSecret(
    user: SecretsUser,
    projectId: string,
    secretId: string,
    value: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<SecretDocument> {
    const secret = await this.secretsRepo.findSecretById(secretId);
    if (!secret || secret.projectId.toString() !== projectId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, secret.environmentId.toString());

    // Enforce write access control
    await this.checkWriteAccess(user, secret.environmentId.toString());

    // Encrypt new value
    const payload = encryptGcm(value, secret.organizationId.toString());

    const newVersion = secret.version + 1;

    // Update secret fields
    secret.encryptedValue = payload.ciphertext;
    secret.iv = payload.iv;
    secret.authTag = payload.authTag;
    secret.version = newVersion;
    await secret.save();

    // Create a new version document (Phase 2.3 version history)
    await this.secretsRepo.createSecretVersion({
      secretId: secret.id,
      organizationId: secret.organizationId.toString(),
      encryptedValue: payload.ciphertext,
      iv: payload.iv,
      authTag: payload.authTag,
      keyVersion: secret.keyVersion,
      version: newVersion,
      createdBy: user.id,
    });

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: secret.organizationId.toString(),
        projectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'secret.updated',
        resource: { type: 'secret', id: secret.id, name: secret.key },
        outcome: 'success',
        metadata: {
          environmentId: secret.environmentId.toString(),
          newVersion,
          apiKeyId: (user as any).apiKeyId || null,
        },
      });
    }

    if (this.webhookPublisher) {
      this.webhookPublisher.publish(
        'secret.updated',
        secret.organizationId.toString(),
        projectId,
        {
          secret: {
            id: secret.id,
            key: secret.key,
            environmentId: secret.environmentId.toString(),
            version: newVersion,
            updatedBy: {
              userId: user.id,
              email: user.email || '',
            }
          }
        }
      ).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

    return secret;
  }

  async deleteSecret(
    user: SecretsUser,
    projectId: string,
    secretId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<void> {
    const secret = await this.secretsRepo.findSecretById(secretId);
    if (!secret || secret.projectId.toString() !== projectId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, secret.environmentId.toString());

    // Enforce write access control
    await this.checkWriteAccess(user, secret.environmentId.toString());

    // Hard delete secret
    await this.secretsRepo.deleteSecret(secretId);

    // Cascade delete versions
    await this.secretsRepo.deleteSecretVersions(secretId);

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: secret.organizationId.toString(),
        projectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'secret.deleted',
        resource: { type: 'secret', id: secret.id, name: secret.key },
        outcome: 'success',
        metadata: {
          environmentId: secret.environmentId.toString(),
          apiKeyId: (user as any).apiKeyId || null,
        },
      });
    }

    if (this.webhookPublisher) {
      this.webhookPublisher.publish(
        'secret.deleted',
        secret.organizationId.toString(),
        projectId,
        {
          secret: {
            id: secret.id,
            key: secret.key,
            environmentId: secret.environmentId.toString(),
            deletedBy: {
              userId: user.id,
              email: user.email || '',
            }
          }
        }
      ).catch((err: any) => console.error('Failed to publish webhook:', err));
    }
  }

  // Versioning & Rollback operations (Phase 2.3)
  async listSecretVersions(
    user: SecretsUser,
    projectId: string,
    secretId: string
  ): Promise<SecretVersionDocument[]> {
    const secret = await this.secretsRepo.findSecretById(secretId);
    if (!secret || secret.projectId.toString() !== projectId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, secret.environmentId.toString());

    // Listing version metadata requires reveal/read access check since it is restricted to those who can see secret info
    await this.checkReadAccess(user, secret.environmentId.toString());

    return this.secretsRepo.listSecretVersions(secretId);
  }

  async rollbackSecret(
    user: SecretsUser,
    projectId: string,
    secretId: string,
    versionNumber: number,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<SecretDocument> {
    const secret = await this.secretsRepo.findSecretById(secretId);
    if (!secret || secret.projectId.toString() !== projectId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, secret.environmentId.toString());

    // Enforce write access control (rollback is a write operation)
    await this.checkWriteAccess(user, secret.environmentId.toString());

    // Retrieve all versions and locate target
    const versions = await this.secretsRepo.listSecretVersions(secretId);
    const targetVersion = versions.find(v => v.version === versionNumber);
    if (!targetVersion) {
      throw new NotFoundError('Secret Version', versionNumber.toString());
    }

    const newVersion = secret.version + 1;

    // Rollback secret values to target version
    secret.encryptedValue = targetVersion.encryptedValue;
    secret.iv = targetVersion.iv;
    secret.authTag = targetVersion.authTag;
    secret.keyVersion = targetVersion.keyVersion;
    secret.version = newVersion;
    await secret.save();

    // Create a new version document recording the rollback write
    await this.secretsRepo.createSecretVersion({
      secretId: secret.id,
      organizationId: secret.organizationId.toString(),
      encryptedValue: targetVersion.encryptedValue,
      iv: targetVersion.iv,
      authTag: targetVersion.authTag,
      keyVersion: targetVersion.keyVersion,
      version: newVersion,
      createdBy: user.id,
    });

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: secret.organizationId.toString(),
        projectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'secret.updated',
        resource: { type: 'secret', id: secret.id, name: secret.key },
        outcome: 'success',
        metadata: {
          environmentId: secret.environmentId.toString(),
          rollbackToVersion: versionNumber,
          newVersion,
          apiKeyId: (user as any).apiKeyId || null,
        },
      });
    }

    if (this.webhookPublisher) {
      this.webhookPublisher.publish(
        'secret.rotated',
        secret.organizationId.toString(),
        projectId,
        {
          secret: {
            id: secret.id,
            key: secret.key,
            environmentId: secret.environmentId.toString(),
            version: newVersion,
            rotatedBy: {
              userId: user.id,
              email: user.email || '',
            }
          }
        }
      ).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

    return secret;
  }

  async revealAllSecrets(
    user: SecretsUser,
    projectSlugOrId: string,
    envSlugOrId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ key: string; value: string }[]> {
    // 1. Resolve project by ID or slug
    let project = await this.projectsRepo.findProjectById(projectSlugOrId);
    if (!project && user.orgId) {
      project = await this.projectsRepo.findProjectBySlug(user.orgId, projectSlugOrId);
    }
    if (!project) {
      throw new NotFoundError('Project', projectSlugOrId);
    }

    const projectId = project.id;

    // 2. Resolve environment by ID or slug
    let env = await this.projectsRepo.findEnvironmentById(envSlugOrId);
    if (!env) {
      env = await this.projectsRepo.findEnvironmentBySlug(projectId, envSlugOrId);
    }
    if (!env || env.projectId.toString() !== projectId) {
      throw new NotFoundError('Environment', envSlugOrId);
    }

    const environmentId = env.id;

    // 3. Enforce API key project & environment boundaries
    this.enforceApiKeyScoping(user, projectId, environmentId);

    // 4. Enforce read access control
    await this.checkReadAccess(user, environmentId);

    // 5. Get all secrets for this environment
    const secrets = await this.secretsRepo.listSecretsByEnv(environmentId);

    const decryptedList: { key: string; value: string }[] = [];

    // 6. Decrypt each secret and record audit log
    for (const secret of secrets) {
      const plaintextValue = decryptGcm(
        {
          ciphertext: secret.encryptedValue,
          iv: secret.iv,
          authTag: secret.authTag,
        },
        secret.organizationId.toString()
      );

      decryptedList.push({
        key: secret.key,
        value: plaintextValue,
      });

      // Update last accessed
      secret.lastAccessedAt = new Date();
      await secret.save();

      // Record audit log for EACH secret revealed
      if (this.auditLogsService) {
        this.auditLogsService.record({
          organizationId: secret.organizationId.toString(),
          projectId,
          actor: {
            userId: user.id,
            ipAddress: clientContext?.ipAddress || null,
            userAgent: clientContext?.userAgent || null,
          },
          action: 'secret.revealed',
          resource: { type: 'secret', id: secret.id, name: secret.key },
          outcome: 'success',
          metadata: {
            environmentId,
            apiKeyId: (user as any).apiKeyId || null,
            bulk: true,
          },
        });
      }
    }

    return decryptedList;
  }
}
