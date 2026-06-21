import { startDeploymentWorker } from './deployment.worker';
import { startWebhookWorker } from './webhook.worker';
import { startEmailWorker } from './email-notification.worker';
import { startSystemWorker } from './system-task.worker';
import { getSystemTasksQueue } from '../config/queue';
import { config } from '../config';

let deploymentWorkerInstance: any = null;
let webhookWorkerInstance: any = null;
let emailWorkerInstance: any = null;
let systemWorkerInstance: any = null;

export function startAllWorkers(): void {
  // Start workers in-process for non-production environments
  if (config.server.env !== 'production') {
    if (!deploymentWorkerInstance) {
      deploymentWorkerInstance = startDeploymentWorker();
      console.log('💚 BullMQ simulated deployment worker started in-process');
    }
    if (!webhookWorkerInstance) {
      webhookWorkerInstance = startWebhookWorker();
      console.log('💚 BullMQ webhook delivery worker started in-process');
    }
    if (!emailWorkerInstance) {
      emailWorkerInstance = startEmailWorker();
      console.log('💚 BullMQ email notification worker started in-process');
    }
    if (!systemWorkerInstance) {
      systemWorkerInstance = startSystemWorker();
      console.log('💚 BullMQ system task worker started in-process');

      // Schedule repeatable job daily at midnight
      const systemQueue = getSystemTasksQueue();
      systemQueue.add('check-expirations', {}, {
        repeat: {
          pattern: '0 0 * * *',
        },
        jobId: 'check-expirations-daily',
      }).catch(err => {
        if (config.server.env !== 'test') {
          console.error('Failed to schedule repeatable check-expirations job:', err);
        }
      });
    }
  }
}

export async function stopAllWorkers(): Promise<void> {
  if (deploymentWorkerInstance) {
    await deploymentWorkerInstance.close();
    deploymentWorkerInstance = null;
    console.log('💚 BullMQ simulated deployment worker stopped');
  }
  if (webhookWorkerInstance) {
    await webhookWorkerInstance.close();
    webhookWorkerInstance = null;
    console.log('💚 BullMQ webhook delivery worker stopped');
  }
  if (emailWorkerInstance) {
    await emailWorkerInstance.close();
    emailWorkerInstance = null;
    console.log('💚 BullMQ email notification worker stopped');
  }
  if (systemWorkerInstance) {
    await systemWorkerInstance.close();
    systemWorkerInstance = null;
    console.log('💚 BullMQ system task worker stopped');
  }
}
