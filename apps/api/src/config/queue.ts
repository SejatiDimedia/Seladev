import { ConnectionOptions, Queue } from 'bullmq';
import { config } from './index';

export const queueConnection: ConnectionOptions = {
  url: config.redis.uri,
  password: config.redis.password || undefined,
};

let deploymentsQueue: Queue | null = null;

export function getDeploymentsQueue(): Queue {
  if (!deploymentsQueue) {
    deploymentsQueue = new Queue('deployments', {
      connection: queueConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1,
      },
    });
  }
  return deploymentsQueue;
}
