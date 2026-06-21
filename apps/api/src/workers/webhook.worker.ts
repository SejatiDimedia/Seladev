import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { queueConnection } from '../config/queue';
import { WebhookModel } from '../infrastructure/database/models/webhook.model';
import { WebhookDeliveryModel } from '../infrastructure/database/models/webhook-delivery.model';
import { decryptGcm } from '../lib/crypto';
import { isPrivateIp } from '../features/webhooks/webhook.validator';
import dns from 'dns';
import { MongooseNotificationsRepository } from '../features/notifications/notifications.repository';
import { NotificationsService } from '../features/notifications/notifications.service';
import { ProjectMemberModel } from '../infrastructure/database/models/project-member.model';
import { MembershipModel } from '../infrastructure/database/models/membership.model';

async function resolveAndCheckSSRF(urlStr: string): Promise<void> {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname;

  // Re-resolve DNS to prevent DNS rebinding attacks
  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (!addresses || addresses.length === 0) {
    throw new Error(`SSRF Validation: Could not resolve hostname '${hostname}'`);
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`SSRF Protection: URL resolves to blocked IP address '${address}'`);
    }
  }
}

const notificationsRepo = new MongooseNotificationsRepository();
const notificationsService = new NotificationsService(notificationsRepo);

async function notifyWebhookFailure(webhookId: string, reason: string) {
  try {
    const webhook = await WebhookModel.findById(webhookId).exec();
    if (!webhook) return;

    let admins: string[] = [];
    if (webhook.projectId) {
      const members = await ProjectMemberModel.find({
        projectId: webhook.projectId,
        role: 'admin',
      }).exec();
      admins = members.map(m => m.userId.toString());
    } else {
      const memberships = await MembershipModel.find({
        organizationId: webhook.organizationId,
        role: { $in: ['admin', 'owner'] },
        status: 'active',
      }).exec();
      admins = memberships.map(m => m.userId.toString());
    }

    const message = `Webhook delivery failed for "${webhook.name}" (${webhook.url}). Reason: ${reason}`;
    const link = webhook.projectId
      ? `/projects/${webhook.projectId.toString()}/webhooks`
      : `/settings`;

    for (const adminId of admins) {
      await notificationsService.createNotification(
        adminId,
        webhook.organizationId.toString(),
        'webhook.delivery_failed',
        'Webhook Delivery Failed',
        message,
        link
      ).catch(err => console.error('Failed to notify webhook failure:', err));
    }
  } catch (err) {
    console.error('Failed to notify webhook failure:', err);
  }
}

export async function processWebhookDelivery(job: Job): Promise<void> {
  const { webhookId, deliveryId, orgId, event, payload } = job.data;
  const startTime = Date.now();
  const attemptNumber = (job.attemptsMade || 0) + 1;
  const isLastAttempt = attemptNumber >= 5;

  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let durationMs: number | null = null;

  // 1. Fetch Webhook configuration
  const webhook = await WebhookModel.findById(webhookId).exec();
  if (!webhook) {
    console.warn(`[Webhook Worker] Webhook '${webhookId}' not found. Skipping.`);
    return;
  }

  if (!webhook.isActive) {
    console.warn(`[Webhook Worker] Webhook '${webhookId}' is inactive. Skipping.`);
    return;
  }

  // 2. Fetch WebhookDelivery record
  const delivery = await WebhookDeliveryModel.findById(deliveryId).exec();
  if (!delivery) {
    console.warn(`[Webhook Worker] WebhookDelivery log '${deliveryId}' not found. Skipping.`);
    return;
  }

  try {
    // 3. DNS Rebinding SSRF Check
    await resolveAndCheckSSRF(webhook.url);

    // 4. Decrypt secret
    const decryptedSecret = decryptGcm(
      {
        ciphertext: webhook.secretCiphertext,
        iv: webhook.secretIv,
        authTag: webhook.secretAuthTag,
      },
      orgId
    );

    // 5. Sign Payload (HMAC-SHA256)
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedContent = `${timestamp}.${rawBody}`;
    
    const signature = `sha256=${crypto
      .createHmac('sha256', decryptedSecret)
      .update(signedContent, 'utf8')
      .digest('hex')}`;

    // 6. Execute HTTP POST request (10-second timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SELADEV-Signature': signature,
          'X-SELADEV-Event': event,
          'X-SELADEV-Delivery': payload.id,
          'X-SELADEV-Timestamp': timestamp,
          'User-Agent': 'SELADEV-Webhook/1.0',
        },
        body: rawBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      durationMs = Date.now() - startTime;
      httpStatus = response.status;
      
      const text = await response.text();
      responseBody = text.slice(0, 1024); // Truncate response body to 1KB

      if (response.ok) {
        // Success
        await WebhookDeliveryModel.findByIdAndUpdate(deliveryId, {
          $set: {
            status: 'delivered',
            statusCode: httpStatus,
            responseTime: durationMs,
            error: null,
            attempt: attemptNumber,
          },
          $push: {
            attempts: {
              attemptNumber,
              startedAt: new Date(startTime),
              completedAt: new Date(),
              durationMs,
              httpStatus,
              responseBody,
              errorMessage: null,
            },
          },
        }).exec();

        // Reset failure streak on Webhook
        await WebhookModel.findByIdAndUpdate(webhookId, {
          $set: {
            failureStreak: 0,
            lastDeliveryStatus: 'delivered',
            lastDeliveryAt: new Date(),
          },
        }).exec();

        return; // Work completed successfully
      } else {
        // HTTP Error status
        errorMessage = `HTTP error: ${response.status} ${response.statusText}`;
      }
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      durationMs = Date.now() - startTime;
      errorMessage = fetchErr.name === 'AbortError' ? 'Timeout: Request exceeded 10 seconds' : fetchErr.message;
    }
  } catch (ssrfOrDecryptErr: any) {
    durationMs = Date.now() - startTime;
    errorMessage = ssrfOrDecryptErr.message;
    // Treating SSRF/internal error as permanent failure directly (attempt 5 status / no retry)
    httpStatus = 400; 
  }

  // Handling Failure
  const finalStatus = httpStatus === 410 ? 'failed' : isLastAttempt ? 'dead_letter' : 'failed';

  await WebhookDeliveryModel.findByIdAndUpdate(deliveryId, {
    $set: {
      status: finalStatus,
      statusCode: httpStatus,
      responseTime: durationMs,
      error: errorMessage,
      attempt: attemptNumber,
    },
    $push: {
      attempts: {
        attemptNumber,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs,
        httpStatus,
        responseBody,
        errorMessage,
      },
    },
  }).exec();

  // Webhook model state updates: failure streak increments
  const updatedWebhook = await WebhookModel.findByIdAndUpdate(
    webhookId,
    {
      $inc: { failureStreak: 1 },
      $set: {
        lastDeliveryStatus: 'failed',
        lastDeliveryAt: new Date(),
      },
    },
    { new: true }
  ).exec();

  // Auto-disable conditions
  if (httpStatus === 410) {
    // 410 Gone -> Permanent failure, disable immediately
    await WebhookModel.findByIdAndUpdate(webhookId, {
      $set: {
        isActive: false,
        disabledAt: new Date(),
      },
    }).exec();
    console.warn(`[Webhook Worker] Webhook '${webhookId}' disabled immediately due to HTTP 410 Gone.`);
    await notifyWebhookFailure(webhookId, 'HTTP 410 Gone (Webhook disabled)').catch(err => console.error('Failed to notify webhook 410 failure:', err));
    return; // Don't throw, stop retrying
  }

  if (updatedWebhook && updatedWebhook.failureStreak >= 100) {
    // 100 consecutive failures -> Disable
    await WebhookModel.findByIdAndUpdate(webhookId, {
      $set: {
        isActive: false,
        disabledAt: new Date(),
      },
    }).exec();
    console.warn(`[Webhook Worker] Webhook '${webhookId}' auto-disabled due to 100 consecutive failures.`);
    await notifyWebhookFailure(webhookId, '100 consecutive failures (Webhook disabled)').catch(err => console.error('Failed to notify webhook streak failure:', err));
    return; // Don't throw, stop retrying
  }

  // Throw error to trigger BullMQ retry logic if not permanent and attempts remaining
  if (!isLastAttempt) {
    throw new Error(errorMessage || 'Webhook delivery failed');
  }

  await notifyWebhookFailure(webhookId, errorMessage || 'All retries exhausted').catch(err => console.error('Failed to notify webhook final retry failure:', err));
}

export function startWebhookWorker(): Worker {
  const worker = new Worker(
    'webhooks',
    async (job: Job) => {
      await processWebhookDelivery(job);
    },
    {
      connection: queueConnection,
      concurrency: 5,
    }
  );

  return worker;
}
