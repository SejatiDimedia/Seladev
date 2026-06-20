import { Worker, Job } from 'bullmq';
import { queueConnection } from '../config/queue';
import { DeploymentModel } from '../infrastructure/database/models/deployment.model';
import { getSocketServer } from '../config/socket';
import { getRedisClient } from '../config/redis';
import type { DeploymentStatus, StatusEvent } from '@seladev/types';
import { MongooseAuditLogsRepository } from '../features/audit-logs/audit-logs.repository';
import { MongooseOrganizationsRepository } from '../features/organizations/organizations.repository';
import { AuditLogsService } from '../features/audit-logs/audit-logs.service';

const auditLogsRepo = new MongooseAuditLogsRepository();
const orgRepo = new MongooseOrganizationsRepository();
const auditLogsService = new AuditLogsService(auditLogsRepo, orgRepo);

async function recordDeploymentAudit(
  deploymentId: string,
  action: 'deployment.completed' | 'deployment.failed' | 'deployment.cancelled',
  outcome: 'success' | 'failure',
  metadata?: any
) {
  try {
    const deployment = await DeploymentModel.findById(deploymentId).exec();
    if (deployment) {
      await auditLogsService.record({
        organizationId: deployment.organizationId.toString(),
        projectId: deployment.projectId.toString(),
        actor: {
          userId: deployment.triggeredBy ? deployment.triggeredBy.toString() : null,
          ipAddress: null,
          userAgent: 'deployment-worker',
        },
        action,
        resource: { type: 'deployment', id: deployment.id, name: deployment.version },
        outcome,
        metadata: {
          branch: deployment.branch,
          ...metadata,
        },
      });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to record deployment audit log in worker:', err);
    }
  }
}

function emitSocketEvent(orgId: string, eventName: string, payload: any) {
  try {
    const io = getSocketServer();
    io.to(`org:${orgId}`).emit(eventName, payload);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to emit Socket.IO event:', err);
    }
  }
}

async function transitionStatus(
  deploymentId: string,
  status: DeploymentStatus,
  message: string,
  completedAt?: Date | null,
  duration?: number | null,
  errorMessage?: string | null
) {
  const timestamp = new Date();
  const event: StatusEvent = {
    status,
    timestamp: timestamp.toISOString(),
    message,
  };

  const update: any = {
    $set: { status },
    $push: { statusHistory: event },
  };

  if (completedAt !== undefined) {
    update.$set.completedAt = completedAt;
  }
  if (duration !== undefined) {
    update.$set.duration = duration;
  }
  if (errorMessage !== undefined) {
    update.$set.errorMessage = errorMessage;
  }

  return DeploymentModel.findByIdAndUpdate(deploymentId, update, { new: true }).exec();
}

const BUILD_LOG_TEMPLATES = [
  '[00:00] Cloning repository...',
  '[00:01] Installing dependencies (pnpm install)...',
  '[00:03] Running type checks (tsc --noEmit)...',
  '[00:04] Running tests (vitest run)...',
  '[00:06] Building production bundle (vite build)...',
  '[00:07] Optimizing assets...',
  '[00:08] Build complete. Bundle size: 428KB (gzipped: 142KB)',
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function processDeployment(job: Job): Promise<void> {
  const { deploymentId, orgId, gitRef } = job.data;
  const startTimestamp = Date.now();

  try {
    const redis = getRedisClient();

    // 1. Helper check for cancellation
    const checkCancelled = async (): Promise<boolean> => {
      const cancelled = await redis.get(`deployment:cancel:${deploymentId}`);
      if (cancelled) {
        const timestamp = new Date();
        await transitionStatus(deploymentId, 'cancelled', 'Deployment cancelled by user', timestamp);
        emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'cancelled' });
        await recordDeploymentAudit(deploymentId, 'deployment.cancelled', 'success', { reason: 'User cancellation request' });
        return true;
      }
      return false;
    };

    if (await checkCancelled()) return;

    // 2. QUEUED → BUILDING
    await transitionStatus(deploymentId, 'building', 'Starting build process');
    emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'building' });

    // 3. Simulate build phase with logs
    const logDelay = process.env.NODE_ENV === 'test' ? 10 : 300; // Faster in tests
    for (const logLine of BUILD_LOG_TEMPLATES) {
      if (await checkCancelled()) return;

      // Append log
      await DeploymentModel.findByIdAndUpdate(deploymentId, {
        $push: { buildLogs: logLine }
      }).exec();

      emitSocketEvent(orgId, 'deployment:log', { deploymentId, line: logLine });
      await sleep(logDelay);
    }

    if (await checkCancelled()) return;

    // 4. BUILDING → DEPLOYING
    await transitionStatus(deploymentId, 'deploying', 'Build complete, deploying to environment');
    emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'deploying' });

    // Simulate deploy phase
    const deployDelay = process.env.NODE_ENV === 'test' ? 20 : 1000;
    await sleep(deployDelay);

    if (await checkCancelled()) return;

    // 5. DEPLOYING → SUCCESS or FAILED
    // Force fail if gitRef/branch is 'fail'
    const forceFail = gitRef === 'fail' || gitRef === 'force-fail';
    const failed = forceFail || (Math.random() < 0.05); // 5% random failure rate

    const endTimestamp = new Date();
    const duration = Date.now() - startTimestamp;

    if (failed) {
      await transitionStatus(
        deploymentId,
        'failed',
        'Deployment failed: container health check timeout',
        endTimestamp,
        duration,
        'Container health check timeout'
      );
      emitSocketEvent(orgId, 'deployment:status_changed', {
        deploymentId,
        status: 'failed',
        error: 'Container health check timeout',
      });
      await recordDeploymentAudit(deploymentId, 'deployment.failed', 'failure', { error: 'Container health check timeout', duration });
    } else {
      await transitionStatus(
        deploymentId,
        'success',
        'Deployment completed successfully',
        endTimestamp,
        duration
      );
      emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'success' });
      await recordDeploymentAudit(deploymentId, 'deployment.completed', 'success', { duration });
    }
  } catch (err: any) {
    console.error('Error during deployment simulation:', err);
    const endTimestamp = new Error().stack ? new Date() : null;
    await transitionStatus(
      deploymentId,
      'failed',
      `Deployment failed with system error: ${err.message}`,
      endTimestamp,
      Date.now() - startTimestamp,
      err.message
    );
    emitSocketEvent(orgId, 'deployment:status_changed', {
      deploymentId,
      status: 'failed',
      error: err.message,
    });
    await recordDeploymentAudit(deploymentId, 'deployment.failed', 'failure', { error: err.message, duration: Date.now() - startTimestamp });
  }
}

export function startDeploymentWorker(): Worker {
  const worker = new Worker(
    'deployments',
    async (job: Job) => {
      await processDeployment(job);
    },
    {
      connection: queueConnection,
      concurrency: 3,
    }
  );

  return worker;
}
