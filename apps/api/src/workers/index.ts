import { startDeploymentWorker } from './deployment.worker';
import { config } from '../config';

let workerInstance: any = null;

export function startAllWorkers(): void {
  // Start workers in-process for non-production environments
  if (config.server.env !== 'production') {
    if (!workerInstance) {
      workerInstance = startDeploymentWorker();
      console.log('💚 BullMQ simulated deployment worker started in-process');
    }
  }
}

export async function stopAllWorkers(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    console.log('💚 BullMQ simulated deployment worker stopped');
  }
}
