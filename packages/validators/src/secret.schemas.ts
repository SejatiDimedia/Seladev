import { z } from 'zod';

export const createSecretSchema = z.object({
  key: z.string().min(1, 'Key is required').max(100, 'Key must be under 100 characters')
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must start with an uppercase letter or underscore and contain only uppercase alphanumeric characters and underscores')
    .trim(),
  value: z.string().min(1, 'Value is required'),
});

export const updateSecretSchema = z.object({
  value: z.string().min(1, 'Value is required'),
});

export type CreateSecretDto = z.infer<typeof createSecretSchema>;
export type UpdateSecretDto = z.infer<typeof updateSecretSchema>;
