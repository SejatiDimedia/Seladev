import { createApiKeySchema as baseCreateSchema, updateApiKeySchema } from '@seladev/validators';
import { z } from 'zod';

export const createApiKeySchema = baseCreateSchema.extend({
  projectId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid project ID').nullable().optional(),
  environmentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid environment ID').nullable().optional(),
});

export { updateApiKeySchema };
