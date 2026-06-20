import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { DeploymentsService } from './deployments.service';
import type { ProjectsService } from '../projects/projects.service';
import { triggerDeploymentSchema } from './deployments.schema';
import type { DeploymentStatus } from '@seladev/types';
import type { DeploymentFilters } from './deployments.types';

export class DeploymentsController {
  constructor(
    private readonly deploymentsService: DeploymentsService,
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

  private getClientContext(req: Request) {
    return {
      ipAddress: req.ip || null,
      userAgent: (req.headers['user-agent'] as string) || null,
    };
  }

  triggerDeployment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const parsed = triggerDeploymentSchema.parse(req.body);
    const user = await this.getUserWithProjRole(req, projectId);

    const dto: {
      environmentId: string;
      branch?: string;
      commitHash?: string;
      commitMessage?: string;
    } = {
      environmentId: parsed.environmentId,
    };

    if (parsed.branch !== undefined) dto.branch = parsed.branch;
    if (parsed.commitHash !== undefined) dto.commitHash = parsed.commitHash;
    if (parsed.commitMessage !== undefined) dto.commitMessage = parsed.commitMessage;

    const deployment = await this.deploymentsService.triggerDeployment(user, projectId, dto, this.getClientContext(req));

    res.status(201).json({
      success: true,
      data: deployment.toJSON(),
    });
  });

  listHistory = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const user = (req as any).user;

    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    
    const filters: DeploymentFilters = {};
    if (req.query.environmentId) {
      filters.environmentId = String(req.query.environmentId);
    }
    if (req.query.status) {
      filters.status = String(req.query.status) as DeploymentStatus;
    }

    const { deployments, hasNext, nextCursor } = await this.deploymentsService.listHistory(
      user,
      projectId,
      limit,
      cursor,
      filters
    );

    res.status(200).json({
      success: true,
      data: deployments.map(d => d.toJSON()),
      pagination: {
        nextCursor,
        hasNext,
      },
    });
  });

  getDeployment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const deploymentId = req.params.deploymentId!;
    const user = (req as any).user;

    const deployment = await this.deploymentsService.getDeployment(user, projectId, deploymentId);

    res.status(200).json({
      success: true,
      data: deployment.toJSON(),
    });
  });

  cancelDeployment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const deploymentId = req.params.deploymentId!;
    const user = await this.getUserWithProjRole(req, projectId);

    const deployment = await this.deploymentsService.cancelDeployment(user, projectId, deploymentId, this.getClientContext(req));

    res.status(200).json({
      success: true,
      data: deployment.toJSON(),
    });
  });

  approveDeployment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const deploymentId = req.params.deploymentId!;
    const user = await this.getUserWithProjRole(req, projectId);

    const deployment = await this.deploymentsService.approveDeployment(user, projectId, deploymentId, this.getClientContext(req));

    res.status(200).json({
      success: true,
      data: deployment.toJSON(),
    });
  });

  rejectDeployment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const deploymentId = req.params.deploymentId!;
    const user = await this.getUserWithProjRole(req, projectId);

    const deployment = await this.deploymentsService.rejectDeployment(user, projectId, deploymentId, this.getClientContext(req));

    res.status(200).json({
      success: true,
      data: deployment.toJSON(),
    });
  });
}
