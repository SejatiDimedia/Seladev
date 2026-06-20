import { z } from 'zod';
export declare const createApiKeySchema: z.ZodObject<{
    name: z.ZodString;
    scopes: z.ZodArray<z.ZodString, "many">;
    expiresInDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    scopes: string[];
    expiresInDays?: number | null | undefined;
}, {
    name: string;
    scopes: string[];
    expiresInDays?: number | null | undefined;
}>;
export declare const updateApiKeySchema: z.ZodObject<{
    isActive: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    isActive: boolean;
}, {
    isActive: boolean;
}>;
export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;
export type UpdateApiKeyDto = z.infer<typeof updateApiKeySchema>;
//# sourceMappingURL=api-key.schemas.d.ts.map