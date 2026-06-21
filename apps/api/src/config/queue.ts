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

let webhooksQueue: Queue | null = null;

export function getWebhooksQueue(): Queue {
  if (!webhooksQueue) {
    webhooksQueue = new Queue('webhooks', {
      connection: queueConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });
  }
  return webhooksQueue;
}

let emailNotificationsQueue: Queue | null = null;

export function getEmailNotificationsQueue(): Queue {
  if (!emailNotificationsQueue) {
    emailNotificationsQueue = new Queue('email-notifications', {
      connection: queueConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });
  }
  return emailNotificationsQueue;
}

let systemTasksQueue: Queue | null = null;

export function getSystemTasksQueue(): Queue {
  if (!systemTasksQueue) {
    systemTasksQueue = new Queue('system-tasks', {
      connection: queueConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1,
      },
    });
  }
  return systemTasksQueue;
}
