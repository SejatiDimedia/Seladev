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

function matchBranch(branch: string, pattern: string): boolean {
  // Simple glob pattern matcher (* matches everything, feature/* matches feature/anything)
  const regexPattern = '^' + pattern.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexPattern);
  return regex.test(branch);
}

export class DeploymentsService {
  constructor(
    private readonly deploymentsRepo: DeploymentsRepository,
    private readonly projectsRepo: ProjectsRepository
  ) {}

  private async verifyProjectAccess(user: { id: string; role: string; orgId: string }, projectId: string) {
    const project = await this.projectsRepo.findProjectById(projectId);
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
    }
  ): Promise<DeploymentDocument> {
    const project = await this.verifyProjectAccess(user, projectId);

    // 1. Verify environment exists and belongs to project
    const env = await this.projectsRepo.findEnvironmentById(dto.environmentId);
    if (!env || env.projectId.toString() !== projectId) {
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
      projectId,
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
          projectId,
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

    return deployment;
  }

  async approveDeployment(
    user: { id: string; role: string; orgId: string; projectRole?: string },
    projectId: string,
    deploymentId: string
  ): Promise<DeploymentDocument> {
    await this.verifyProjectAccess(user, projectId);

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== projectId) {
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
        projectId,
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

    return updated;
  }

  async rejectDeployment(
    user: { id: string; role: string; orgId: string; projectRole?: string },
    projectId: string,
    deploymentId: string
  ): Promise<DeploymentDocument> {
    await this.verifyProjectAccess(user, projectId);

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== projectId) {
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

    return updated;
  }

  async cancelDeployment(
    user: { id: string; role: string; orgId: string; projectRole?: string },
    projectId: string,
    deploymentId: string
  ): Promise<DeploymentDocument> {
    await this.verifyProjectAccess(user, projectId);

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== projectId) {
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
    await this.verifyProjectAccess(user, projectId);

    const deployment = await this.deploymentsRepo.findDeploymentById(deploymentId);
    if (!deployment || deployment.projectId.toString() !== projectId) {
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
    await this.verifyProjectAccess(user, projectId);
    return this.deploymentsRepo.listHistory(projectId, limit, cursor, filters);
  }
}
