import { z } from 'zod';

export const createWebhookSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be under 50 characters').trim(),
  url: z.string().url('Invalid webhook URL'),
  events: z.array(z.string()).min(1, 'At least one event subscription is required'),
  projectId: z.string().optional().nullable(),
});

export const updateWebhookSchema = createWebhookSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;
