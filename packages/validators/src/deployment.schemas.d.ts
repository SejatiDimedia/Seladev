import { z } from 'zod';
export declare const triggerDeploymentSchema: z.ZodObject<{
    environmentId: z.ZodString;
    commitHash: z.ZodOptional<z.ZodString>;
    commitMessage: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    environmentId: string;
    commitHash?: string | undefined;
    commitMessage?: string | undefined;
    branch?: string | undefined;
}, {
    environmentId: string;
    commitHash?: string | undefined;
    commitMessage?: string | undefined;
    branch?: string | undefined;
}>;
export type TriggerDeploymentDto = z.infer<typeof triggerDeploymentSchema>;
//# sourceMappingURL=deployment.schemas.d.ts.map