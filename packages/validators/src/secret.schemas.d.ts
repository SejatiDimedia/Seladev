import { z } from 'zod';
export declare const createSecretSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    key: string;
}, {
    value: string;
    key: string;
}>;
export declare const updateSecretSchema: z.ZodObject<{
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
}, {
    value: string;
}>;
export type CreateSecretDto = z.infer<typeof createSecretSchema>;
export type UpdateSecretDto = z.infer<typeof updateSecretSchema>;
//# sourceMappingURL=secret.schemas.d.ts.map