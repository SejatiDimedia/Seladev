import type { DeploymentsRepository } from './deployments.repository';
import type { ProjectsRepository } from '../projects/projects.repository';
import { getDeploymentsQueue } from '../../config/queue';
import { getRedisClient } from '../../config/redis';
import { 
  NotFoundError, 
  ValidationError, 
  ForbiddenError 
} from '../../lib/errors';
import type { DeploymentDocument } from '../../infrastructure/database/models/deployment.model';
import type { DeploymentStatus, StatusEvent } from '@seladev/types';
import type { DeploymentFilters } from './deployments.types';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';

function matchBranch(branch: string, pattern: string): boolean {
  // Simple glob pattern matcher (* matches everything, feature/* matches feature/anything)
  const regexPattern = '^' + pattern.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexPattern);
  return regex.test(branch);
}

export class DeploymentsService {
  constructor(
    private readonly deploymentsRepo: DeploymentsRepository,
    private readonly projectsRepo: ProjectsRepository,
    private readonly auditLogsService?: AuditLogsService,
    private readonly webhookPublisher?: any
  ) {}

  private async verifyProjectAccess(user: { id: string; role: string; orgId: string }, projectId: string) {
    let project = await this.projectsRepo.findProjectById(projectId);
    if (!project && user.orgId) {
      project = await this.projectsRepo.findProjectBySlug(user.orgId, projectId);
    }
    if (!project || project.organizationId.toString() !== user.orgId) {
      throw new NotFoundError('Project', projectId);
    }
    return project;
  }

  async triggerDeployment(
    user: { id: string; role: string; orgId: string },
    projectId: string,
    dto: {
      environmentId: string;
      branch?: string;
      commitHash?: string;
      commitMessage?: string;
    },
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);
    const resolvedProjectId = project.id;

    // 1. Verify environment exists and belongs to project (resolve by ID or slug)
    let env = await this.projectsRepo.findEnvironmentById(dto.environmentId);
    if (!env) {
      env = await this.projectsRepo.findEnvironmentBySlug(resolvedProjectId, dto.environmentId);
    }
    if (!env || env.projectId.toString() !== resolvedProjectId) {
      throw new NotFoundError('Environment', dto.environmentId);
    }

    const branch = dto.branch || 'main';

    // 2. Validate branch restrictions
    if (project.settings?.allowedBranches && project.settings.allowedBranches.length > 0) {
      const isAllowed = project.settings.allowedBranches.some(pattern => matchBranch(branch, pattern));
      if (!isAllowed) {
        throw new ValidationError(
          [],
          `Branch '${branch}' is not allowed for deployments in this project. Allowed branches: ${project.settings.allowedBranches.join(', ')}`
        );
      }
    }

    // 3. Determine if manual approval is required
    const requiresApproval = env.isProtected && project.settings?.deploymentProtection;
    const initialStatus: DeploymentStatus = requiresApproval ? 'pending_approval' : 'queued';

    const timestamp = new Date();
    const statusHistory: StatusEvent[] = [
      {
        status: initialStatus,
        timestamp: timestamp.toISOString(),
        message: requiresApproval
          ? 'Deployment is pending manual approval for protected environment'
          : 'Deployment triggered and queued',
      },
    ];

    // 4. Create Deployment record
    const deployment = await this.deploymentsRepo.createDeployment({
      organizationId: project.organizationId.toString(),
      projectId: resolvedProjectId,
      environmentId: env.id,
      version: dto.commitHash ? dto.commitHash.slice(0, 7) : 'v1.0.0', // Fallback version
      branch,
      commitSha: dto.commitHash || null,
      commitMessage: dto.commitMessage || null,
      status: initialStatus,
      statusHistory,
      triggeredBy: user.id,
      triggeredVia: 'ui', // Triggered via UI in this flow
    });

    // 5. If no approval needed, add job to BullMQ queue
    if (!requiresApproval) {
      const queue = getDeploymentsQueue();
      await queue.add(
        'deployment',
        {
          deploymentId: deployment.id,
          orgId: project.organizationId.toString(),
          projectId: resolvedProjectId,
          environmentId: env.id,
          triggeredBy: user.id,
          gitRef: branch,
          buildConfig: {
            runtime: 'node:20',
            buildCommand: 'pnpm run build',
            startCommand: 'pnpm start',
            envVars: {}, // Configured environment variables (if any)
          },
        },
        { jobId: deployment.id }
      );
    }

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: project.organizationId.toString(),
        projectId: resolvedProjectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'deployment.triggered',
        resource: { type: 'deployment', id: deployment.id, name: deployment.version },
        outcome: 'success',
        metadata: {
          environmentId: env.id,
          branch,
          commitSha: dto.commitHash || null,
          requiresApproval,
        },
      });
    }

    if (this.webhookPublisher && !requiresApproval) {
      this.webhookPublisher.publish('deployment.queued', project.organizationId.toString(), resolvedProjectId, {
        deployment: {
          id: deployment.id,
          status: 'queued',
          environmentId: env.id,
          triggeredBy: { userId: user.id },
          gitRef: branch,
          startedAt: new Date().toISOString(),
        }
      }).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

    return deployment;
  }

  async approveDeployment(
    user: { id: string; role: string; orgId: string; projectRole?: string },
    projectId: string,
    deploymentId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);
    const resolvedProjectId = project.id;

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== resolvedProjectId) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    if (deployment.status !== 'pending_approval') {
      throw new ValidationError([], `Cannot approve deployment in status: ${deployment.status}`);
    }

    // Verify user is project admin or organization admin/owner
    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    const isProjAdmin = user.projectRole === 'admin';
    if (!isOrgAdmin && !isProjAdmin) {
      throw new ForbiddenError('Only project administrators can approve deployments');
    }

    const timestamp = new Date();
    const event: StatusEvent = {
      status: 'queued',
      timestamp: timestamp.toISOString(),
      message: `Deployment approved by ${user.role}`,
    };

    const updated = await this.deploymentsRepo.updateStatus(
      deploymentId,
      'queued',
      event
    );

    if (!updated) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    // Add to BullMQ
    const queue = getDeploymentsQueue();
    await queue.add(
      'deployment',
      {
        deploymentId: updated.id,
        orgId: updated.organizationId.toString(),
        projectId: resolvedProjectId,
        environmentId: updated.environmentId.toString(),
        triggeredBy: updated.triggeredBy.toString(),
        gitRef: updated.branch || 'main',
        buildConfig: {
          runtime: 'node:20',
          buildCommand: 'pnpm run build',
          startCommand: 'pnpm start',
          envVars: {},
        },
      },
      { jobId: updated.id }
    );

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: updated.organizationId.toString(),
        projectId: resolvedProjectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'deployment.approved',
        resource: { type: 'deployment', id: updated.id, name: updated.version },
        outcome: 'success',
        metadata: {
          environmentId: updated.environmentId.toString(),
          branch: updated.branch,
        },
      });
    }

    if (this.webhookPublisher) {
      this.webhookPublisher.publish('deployment.queued', updated.organizationId.toString(), resolvedProjectId, {
        deployment: {
          id: updated.id,
          status: 'queued',
          environmentId: updated.environmentId.toString(),
          triggeredBy: { userId: updated.triggeredBy.toString() },
          gitRef: updated.branch || 'main',
          startedAt: new Date().toISOString(),
        }
      }).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

    return updated;
  }

  async rejectDeployment(
    user: { id: string; role: string; orgId: string; projectRole?: string },
    projectId: string,
    deploymentId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);
    const resolvedProjectId = project.id;

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== resolvedProjectId) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    if (deployment.status !== 'pending_approval') {
      throw new ValidationError([], `Cannot reject deployment in status: ${deployment.status}`);
    }

    // Verify user is project admin or organization admin/owner
    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    const isProjAdmin = user.projectRole === 'admin';
    if (!isOrgAdmin && !isProjAdmin) {
      throw new ForbiddenError('Only project administrators can reject deployments');
    }

    const timestamp = new Date();
    const event: StatusEvent = {
      status: 'cancelled',
      timestamp: timestamp.toISOString(),
      message: `Deployment rejected by ${user.role}`,
    };

    const updated = await this.deploymentsRepo.updateStatus(
      deploymentId,
      'cancelled',
      event,
      timestamp // Completed at rejection time
    );

    if (!updated) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: updated.organizationId.toString(),
        projectId: resolvedProjectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'deployment.rejected',
        resource: { type: 'deployment', id: updated.id, name: updated.version },
        outcome: 'success',
        metadata: {
          environmentId: updated.environmentId.toString(),
          branch: updated.branch,
        },
      });
    }

    return updated;
  }

  async cancelDeployment(
    user: { id: string; role: string; orgId: string; projectRole?: string },
    projectId: string,
    deploymentId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);
    const resolvedProjectId = project.id;

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== resolvedProjectId) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    const terminalStates: DeploymentStatus[] = ['success', 'failed', 'cancelled'];
    if (terminalStates.includes(deployment.status)) {
      throw new ValidationError([], `Cannot cancel deployment in terminal state: ${deployment.status}`);
    }

    if (deployment.status === 'deploying') {
      throw new ValidationError([], 'Deployment is already deploying and cannot be cancelled');
    }

    // Verify user is project admin or organization admin/owner
    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    const isProjAdmin = user.projectRole === 'admin';
    if (!isOrgAdmin && !isProjAdmin) {
      throw new ForbiddenError('Only project administrators can cancel deployments');
    }

    const timestamp = new Date();
    const event: StatusEvent = {
      status: 'cancelled',
      timestamp: timestamp.toISOString(),
      message: 'Deployment cancelled by user',
    };

    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: deployment.organizationId.toString(),
        projectId: resolvedProjectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'deployment.cancelled',
        resource: { type: 'deployment', id: deployment.id, name: deployment.version },
        outcome: 'success',
        metadata: {
          environmentId: deployment.environmentId.toString(),
          branch: deployment.branch,
          cancelledDuringState: deployment.status,
        },
      });
    }

    if (deployment.status === 'queued' || deployment.status === 'pending_approval') {
      // 1. Remove from BullMQ if present in queue
      try {
        const queue = getDeploymentsQueue();
        const job = await queue.getJob(deploymentId);
        if (job) {
          await job.remove();
        }
      } catch (err) {
        console.warn('Failed to remove job from BullMQ queue directly:', err);
      }

      // 2. Set database status immediately
      const updated = await this.deploymentsRepo.updateStatus(
        deploymentId,
        'cancelled',
        event,
        timestamp
      );
      if (!updated) {
        throw new NotFoundError('Deployment', deploymentId);
      }

      if (this.webhookPublisher) {
        this.webhookPublisher.publish('deployment.cancelled', updated.organizationId.toString(), resolvedProjectId, {
          deployment: {
            id: updated.id,
            status: 'cancelled',
            environmentId: updated.environmentId.toString(),
            triggeredBy: { userId: updated.triggeredBy.toString() },
            gitRef: updated.branch || 'main',
            completedAt: new Date().toISOString(),
          }
        }).catch((err: any) => console.error('Failed to publish webhook:', err));
      }

      return updated;
    }

    if (deployment.status === 'building') {
      // Set Redis cancellation key, the worker will pick it up at next checkpoint
      const redis = getRedisClient();
      await redis.set(`deployment:cancel:${deploymentId}`, '1', { EX: 600 });

      // Return deployment, it will be transitioned to cancelled by the worker
      return deployment;
    }

    return deployment;
  }

  async getDeployment(
    user: { id: string; role: string; orgId: string },
    projectId: string,
    deploymentId: string
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== project.id) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    return deployment;
  }

  async listHistory(
    user: { id: string; role: string; orgId: string },
    projectId: string,
    limit: number,
    cursor?: string | null,
    filters?: DeploymentFilters
  ): Promise<{ deployments: DeploymentDocument[]; hasNext: boolean; nextCursor: string | null }> {
    const project = await this.verifyProjectAccess(user, projectId);
    return this.deploymentsRepo.listHistory(project.id, limit, cursor, filters);
  }

  async promoteDeployment(
    user: { id: string; role: string; orgId: string },
    projectId: string,
    deploymentId: string,
    targetEnvSlugOrId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);
    const resolvedProjectId = project.id;

    // 1. Fetch original deployment
    const sourceDeployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!sourceDeployment || sourceDeployment.projectId.toString() !== resolvedProjectId) {
      throw new NotFoundError('Deployment', deploymentId);
    }

    // Ensure original deployment was successful
    if (sourceDeployment.status !== 'success') {
      throw new ValidationError([], `Only successful deployments can be promoted. Current status: ${sourceDeployment.status}`);
    }

    // 2. Resolve target environment by ID or slug
    let env = await this.projectsRepo.findEnvironmentById(targetEnvSlugOrId);
    if (!env) {
      env = await this.projectsRepo.findEnvironmentBySlug(resolvedProjectId, targetEnvSlugOrId);
    }
    if (!env || env.projectId.toString() !== resolvedProjectId) {
      throw new NotFoundError('Environment', targetEnvSlugOrId);
    }

    // Cannot promote to the same environment
    if (sourceDeployment.environmentId.toString() === env.id) {
      throw new ValidationError([], 'Cannot promote deployment to the same environment it was deployed to');
    }

    // 3. Determine if manual approval is required
    const requiresApproval = env.isProtected && project.settings?.deploymentProtection;
    const initialStatus: DeploymentStatus = requiresApproval ? 'pending_approval' : 'queued';

    // Retrieve source environment to get its name for status history message
    const sourceEnv = await this.projectsRepo.findEnvironmentById(sourceDeployment.environmentId.toString());
    const sourceEnvName = sourceEnv ? sourceEnv.name : 'unknown';

    const timestamp = new Date();
    const statusHistory: StatusEvent[] = [
      {
        status: initialStatus,
        timestamp: timestamp.toISOString(),
        message: requiresApproval
          ? `Deployment promoted from ${sourceEnvName} (pending manual approval for protected environment)`
          : `Deployment promoted from ${sourceEnvName} and queued`,
      },
    ];

    // 4. Create promoted Deployment record
    const promotedDeployment = await this.deploymentsRepo.createDeployment({
      organizationId: project.organizationId.toString(),
      projectId: resolvedProjectId,
      environmentId: env.id,
      version: sourceDeployment.version,
      branch: sourceDeployment.branch,
      commitSha: sourceDeployment.commitSha,
      commitMessage: sourceDeployment.commitMessage,
      status: initialStatus,
      statusHistory,
      triggeredBy: user.id,
      triggeredVia: 'api', // triggered via API/CLI
    });

    // 5. If no approval needed, add job to BullMQ queue
    if (!requiresApproval) {
      const queue = getDeploymentsQueue();
      await queue.add('deployment-job', {
        deploymentId: promotedDeployment.id,
        orgId: project.organizationId.toString(),
      });
    }

    // 6. Record audit log
    if (this.auditLogsService) {
      this.auditLogsService.record({
        organizationId: project.organizationId.toString(),
        projectId: resolvedProjectId,
        actor: {
          userId: user.id,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        action: 'deployment.promoted',
        resource: { type: 'deployment', id: promotedDeployment.id, name: promotedDeployment.version },
        outcome: 'success',
        metadata: {
          sourceDeploymentId: deploymentId,
          sourceEnvironmentId: sourceDeployment.environmentId.toString(),
          targetEnvironmentId: env.id,
          status: initialStatus,
          apiKeyId: (user as any).apiKeyId || null,
        },
      }).catch(err => console.error('Failed to log audit:', err));
    }

    // 7. Publish Webhook
    if (this.webhookPublisher) {
      this.webhookPublisher.publish(
        'deployment.triggered',
        project.organizationId.toString(),
        resolvedProjectId,
        {
          deployment: {
            id: promotedDeployment.id,
            version: promotedDeployment.version,
            environmentId: env.id,
            status: initialStatus,
            triggeredBy: {
              userId: user.id,
            },
            triggeredVia: 'api',
            metadata: {
              promoted: true,
              sourceDeploymentId: deploymentId,
            }
          }
        }
      ).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

    return promotedDeployment;
  }
}
