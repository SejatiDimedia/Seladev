import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { WebhooksService } from './webhooks.service';
import { createWebhookSchema, updateWebhookSchema } from '@seladev/validators';
import type { WebhooksFilters, WebhookDeliveriesFilters } from './webhooks.types';

export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  createWebhook = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const userId = (req as any).user.id;
    const dto = createWebhookSchema.parse(req.body);

    const result = await this.webhooksService.createWebhook(orgId, userId, dto);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  listWebhooks = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId } = req.params;
    if (!orgId) {
      res.status(400).json({ success: false, message: 'Organization ID is required' });
      return;
    }
    const projectId = req.query.projectId as string | undefined;

    const filters: WebhooksFilters = {};
    if (projectId) {
      filters.projectId = projectId;
    }

    const webhooks = await this.webhooksService.listWebhooks(orgId, filters);

    res.status(200).json({
      success: true,
      data: webhooks,
    });
  });

  getWebhook = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId } = req.params;
    if (!orgId || !webhookId) {
      res.status(400).json({ success: false, message: 'Organization ID and Webhook ID are required' });
      return;
    }

    const webhook = await this.webhooksService.getWebhook(orgId, webhookId);

    res.status(200).json({
      success: true,
      data: webhook,
    });
  });

  updateWebhook = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId } = req.params;
    if (!orgId || !webhookId) {
      res.status(400).json({ success: false, message: 'Organization ID and Webhook ID are required' });
      return;
    }
    const userId = (req as any).user.id;
    const dto = updateWebhookSchema.parse(req.body);

    const updated = await this.webhooksService.updateWebhook(orgId, webhookId, userId, dto);

    res.status(200).json({
      success: true,
      data: updated,
    });
  });

  deleteWebhook = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId } = req.params;
    if (!orgId || !webhookId) {
      res.status(400).json({ success: false, message: 'Organization ID and Webhook ID are required' });
      return;
    }
    const userId = (req as any).user.id;

    await this.webhooksService.deleteWebhook(orgId, webhookId, userId);

    res.status(200).json({
      success: true,
      message: 'Webhook deleted successfully',
    });
  });

  rotateSecret = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId } = req.params;
    if (!orgId || !webhookId) {
      res.status(400).json({ success: false, message: 'Organization ID and Webhook ID are required' });
      return;
    }
    const userId = (req as any).user.id;

    const newSecret = await this.webhooksService.rotateSecret(orgId, webhookId, userId);

    res.status(200).json({
      success: true,
      data: {
        secret: newSecret,
        rotatedAt: new Date().toISOString(),
      },
    });
  });

  testWebhook = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId } = req.params;
    if (!orgId || !webhookId) {
      res.status(400).json({ success: false, message: 'Organization ID and Webhook ID are required' });
      return;
    }
    const userId = (req as any).user.id;

    const deliveryId = await this.webhooksService.testWebhook(orgId, webhookId, userId);

    res.status(202).json({
      success: true,
      data: {
        deliveryId,
        message: 'Test delivery enqueued',
      },
    });
  });

  listDeliveries = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId } = req.params;
    if (!orgId || !webhookId) {
      res.status(400).json({ success: false, message: 'Organization ID and Webhook ID are required' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);
    const cursor = req.query.cursor as string | undefined;
    const status = req.query.status as any;
    const eventType = req.query.eventType as string | undefined;

    const filters: WebhookDeliveriesFilters = {};
    if (status) filters.status = status;
    if (eventType) filters.eventType = eventType;

    const result = await this.webhooksService.listDeliveries(orgId, webhookId, limit, cursor, filters);

    res.status(200).json({
      success: true,
      data: result.deliveries,
      pagination: {
        hasNext: result.hasNext,
        nextCursor: result.nextCursor,
      },
    });
  });

  getDelivery = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { orgId, webhookId, deliveryId } = req.params;
    if (!orgId || !webhookId || !deliveryId) {
      res.status(400).json({ success: false, message: 'Organization ID, Webhook ID, and Delivery ID are required' });
      return;
    }

    const delivery = await this.webhooksService.getDelivery(orgId, webhookId, deliveryId);

    res.status(200).json({
      success: true,
      data: delivery,
    });
  });
}
