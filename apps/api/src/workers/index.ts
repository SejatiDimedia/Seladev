import { startDeploymentWorker } from './deployment.worker';
import { startWebhookWorker } from './webhook.worker';
import { config } from '../config';

let deploymentWorkerInstance: any = null;
let webhookWorkerInstance: any = null;

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
}
