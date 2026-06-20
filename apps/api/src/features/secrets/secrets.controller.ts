import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { SecretsService } from './secrets.service';
import type { ProjectsService } from '../projects/projects.service';
import { createSecretSchema, updateSecretSchema } from './secrets.schema';
import { ValidationError } from '../../lib/errors';

export class SecretsController {
  constructor(
    private readonly secretsService: SecretsService,
    private readonly projectsService: ProjectsService
  ) {}

  private async getUserWithProjRole(req: Request, projectId: string) {
    const user = (req as any).user;
    const projectMember = await this.projectsService.findProjectMember(projectId, user.id);
    return {
      ...user,
      projectRole: projectMember ? projectMember.role : undefined
    };
  }

  createSecret = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const envId = req.params.envId!;
    const { key, value } = createSecretSchema.parse(req.body);
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;

    const user = await this.getUserWithProjRole(req, projectId);
    const secret = await this.secretsService.createSecret(user, projectId, envId, key, value, expiresAt);

    res.status(201).json({
      success: true,
      data: secret.toJSON(),
    });
  });

  listSecrets = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const envId = req.params.envId!;

    const user = await this.getUserWithProjRole(req, projectId);
    const secrets = await this.secretsService.listSecrets(user, projectId, envId);

    // According to 02-requirements.md:
    // GET /api/v1/projects/:projectId/environments/:envId/secrets MUST return value: "****" for all roles.
    const data = secrets.map(s => {
      const json = s.toJSON();
      return {
        ...json,
        value: '****',
      };
    });

    res.status(200).json({
      success: true,
      data,
    });
  });

  getSecretMetadata = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const secretId = req.params.secretId!;

    const user = await this.getUserWithProjRole(req, projectId);
    const secret = await this.secretsService.getSecretMetadata(user, projectId, secretId);

    const json = secret.toJSON();
    res.status(200).json({
      success: true,
      data: {
        ...json,
        value: '****',
      },
    });
  });

  revealSecret = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const secretId = req.params.secretId!;

    const user = await this.getUserWithProjRole(req, projectId);
    const { secret, plaintextValue } = await this.secretsService.revealSecret(user, projectId, secretId);

    const json = secret.toJSON();
    res.status(200).json({
      success: true,
      data: {
        ...json,
        value: plaintextValue,
      },
    });
  });

  updateSecret = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const secretId = req.params.secretId!;
    const { value } = updateSecretSchema.parse(req.body);

    const user = await this.getUserWithProjRole(req, projectId);
    const secret = await this.secretsService.updateSecret(user, projectId, secretId, value);

    res.status(200).json({
      success: true,
      data: secret.toJSON(),
    });
  });

  deleteSecret = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const secretId = req.params.secretId!;

    const user = await this.getUserWithProjRole(req, projectId);
    await this.secretsService.deleteSecret(user, projectId, secretId);

    res.status(204).end();
  });

  // Versioning and rollback (Phase 2.3)
  listSecretVersions = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const secretId = req.params.secretId!;

    const user = await this.getUserWithProjRole(req, projectId);
    const versions = await this.secretsService.listSecretVersions(user, projectId, secretId);

    res.status(200).json({
      success: true,
      data: versions.map(v => v.toJSON()),
    });
  });

  rollbackSecret = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const secretId = req.params.secretId!;
    const version = Number(req.body.version);

    if (isNaN(version) || version <= 0) {
      throw new ValidationError([], 'Valid version number must be provided in request body');
    }

    const user = await this.getUserWithProjRole(req, projectId);
    const secret = await this.secretsService.rollbackSecret(user, projectId, secretId, version);

    res.status(200).json({
      success: true,
      data: secret.toJSON(),
    });
  });
}
