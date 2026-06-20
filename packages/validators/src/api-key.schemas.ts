import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be under 50 characters').trim(),
  scopes: z.array(z.string()).min(1, 'At least one scope is required'),
  expiresInDays: z.number().int().positive().nullable().optional(),
});

export const updateApiKeySchema = z.object({
  isActive: z.boolean(),
});

export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;
export type UpdateApiKeyDto = z.infer<typeof updateApiKeySchema>;
