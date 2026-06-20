export interface Webhook {
    id: string;
    organizationId: string;
    projectId: string | null;
    name: string;
    url: string;
    events: string[];
    secret: string;
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
    responseTime: number | null;
    attempt: number;
    error: string | null;
    createdAt: string;
}
//# sourceMappingURL=webhook.types.d.ts.map