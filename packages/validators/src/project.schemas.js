import { z } from 'zod';
export const createProjectSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(64, 'Name must be under 64 characters').trim(),
    description: z.string().max(500, 'Description must be under 500 characters').optional().default(''),
    visibility: z.enum(['private', 'internal']).default('private'),
    repositoryUrl: z.string().url('Invalid repository URL').nullable().optional(),
    tags: z.array(z.string()).default([]),
});
export const updateProjectSchema = createProjectSchema.partial();
//# sourceMappingURL=project.schemas.js.map