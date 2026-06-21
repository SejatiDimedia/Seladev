import { z } from 'zod';

export const preferenceItemSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
});

export const updatePreferencesSchema = z.object({
  deployment: preferenceItemSchema,
  secret: preferenceItemSchema,
  apiKey: preferenceItemSchema,
  webhook: preferenceItemSchema,
});

export type UpdatePreferencesDto = z.infer<typeof updatePreferencesSchema>;
