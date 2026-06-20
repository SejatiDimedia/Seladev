import { z } from 'zod';

export const createEnvironmentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(30, 'Name must be under 30 characters').trim(),
  description: z.string().max(200, 'Description must be under 200 characters').optional().default(''),
});

export const updateEnvironmentSchema = createEnvironmentSchema.partial();

export type CreateEnvironmentDto = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentDto = z.infer<typeof updateEnvironmentSchema>;
