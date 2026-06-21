import { Worker } from 'bullmq';
import { queueConnection } from '../config/queue';
import { MongooseNotificationsRepository } from '../features/notifications/notifications.repository';
import { NotificationsService } from '../features/notifications/notifications.service';

const notificationsRepo = new MongooseNotificationsRepository();
const notificationsService = new NotificationsService(notificationsRepo);

export function startSystemWorker(): Worker {
  const worker = new Worker(
    'system-tasks',
    async (job) => {
      if (job.name === 'check-expirations') {
        if (process.env.NODE_ENV !== 'test') {
          console.log('🔄 [System Worker] Running expiration checks for secrets and API keys...');
        }
        await notificationsService.checkExpirations();
        if (process.env.NODE_ENV !== 'test') {
          console.log('✅ [System Worker] Expiration checks completed.');
        }
      }
    },
    {
      connection: queueConnection,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ [System Worker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
