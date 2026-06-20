import { z } from 'zod';
export const triggerDeploymentSchema = z.object({
    environmentId: z.string().min(1, 'Environment ID is required'),
    commitHash: z.string().max(40).optional(),
    commitMessage: z.string().max(200).optional(),
    branch: z.string().max(100).optional(),
});
//# sourceMappingURL=deployment.schemas.js.map