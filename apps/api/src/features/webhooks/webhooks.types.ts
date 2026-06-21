import type { WebhookDocument } from '../../infrastructure/database/models/webhook.model';
import type { WebhookDeliveryDocument } from '../../infrastructure/database/models/webhook-delivery.model';
import type { CreateWebhookDto } from '@seladev/validators';

export interface WebhooksFilters {
  projectId?: string | null;
  isActive?: boolean;
}

export interface WebhookDeliveriesFilters {
  status?: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  eventType?: string;
}

export interface WebhooksRepository {
  findWebhookById(id: string): Promise<WebhookDocument | null>;
  findWebhooksByOrg(orgId: string, filters?: WebhooksFilters): Promise<WebhookDocument[]>;
  findActiveWebhooksForEvent(orgId: string, eventType: string, projectId?: string | null): Promise<WebhookDocument[]>;
  createWebhook(
    orgId: string,
    createdBy: string,
    data: CreateWebhookDto & { secretCiphertext: string; secretIv: string; secretAuthTag: string }
  ): Promise<WebhookDocument>;
  updateWebhook(id: string, update: Partial<WebhookDocument>): Promise<WebhookDocument | null>;
  deleteWebhook(id: string): Promise<boolean>;

  // Deliveries logs
  findDeliveryById(id: string): Promise<WebhookDeliveryDocument | null>;
  findDeliveriesByWebhook(
    webhookId: string,
    limit: number,
    cursor?: string,
    filters?: WebhookDeliveriesFilters
  ): Promise<{ deliveries: WebhookDeliveryDocument[]; hasNext: boolean; nextCursor: string | null }>;
  createDelivery(data: Partial<WebhookDeliveryDocument>): Promise<WebhookDeliveryDocument>;
  updateDelivery(id: string, update: Partial<WebhookDeliveryDocument>): Promise<WebhookDeliveryDocument | null>;
}
