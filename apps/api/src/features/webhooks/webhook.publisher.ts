import mongoose from 'mongoose';
import type { WebhooksRepository } from './webhooks.types';
import { getWebhooksQueue } from '../../config/queue';

export class WebhookPublisher {
  constructor(private readonly webhookRepo: WebhooksRepository) {}

  async publish(
    event: string,
    orgId: string,
    projectId: string | null,
    data: Record<string, any>
  ): Promise<void> {
    try {
      // 1. Find all active webhooks for this org/project that subscribe to this event
      const webhooks = await this.webhookRepo.findActiveWebhooksForEvent(orgId, event, projectId);

      if (webhooks.length === 0) return;

      const apiVersion = '2026-06-01';
      const timestamp = new Date().toISOString();

      await Promise.all(
        webhooks.map(async (webhook) => {
          const deliveryId = new mongoose.Types.ObjectId();
          const eventId = `evt_${deliveryId.toString()}`;

          const payload = {
            id: eventId,
            event,
            apiVersion,
            orgId,
            projectId: projectId || null,
            timestamp,
            data,
          };

          // Create pending delivery log entry
          const delivery = await this.webhookRepo.createDelivery({
            _id: deliveryId,
            webhookId: webhook._id,
            organizationId: new mongoose.Types.ObjectId(orgId),
            eventId,
            eventType: event,
            payload,
            status: 'pending',
            attempt: 1,
            attempts: [],
          });

          // Enqueue delivery job in BullMQ
          const queue = getWebhooksQueue();
          await queue.add(
            'deliver',
            {
              webhookId: webhook.id,
              deliveryId: delivery.id,
              orgId,
              event,
              payload,
            },
            {
              jobId: `webhook:${webhook.id}:${delivery.id}`,
              removeOnComplete: true,
              removeOnFail: false,
            }
          );
        })
      );
    } catch (err) {
      // Don't fail the main request if webhook publishing fails
      console.error(`[WebhookPublisher] Failed to publish event '${event}':`, err);
    }
  }
}
