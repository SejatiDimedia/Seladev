export interface Webhook {
  id: string;
  organizationId: string;
  projectId: string | null; // Scoped to org or a specific project
  name: string;
  url: string;
  events: string[];
  secret: string; // HMAC signing key
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  responseTime: number | null; // in milliseconds
  attempt: number;
  error: string | null;
  createdAt: string;
}
