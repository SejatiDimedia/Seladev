import { z } from 'zod';
export declare const createEnvironmentSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
}, {
    name: string;
    description?: string | undefined;
}>;
export declare const updateEnvironmentSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodDefault<z.ZodOptional<z.ZodString>>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    description?: string | undefined;
}, {
    name?: string | undefined;
    description?: string | undefined;
}>;
export type CreateEnvironmentDto = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentDto = z.infer<typeof updateEnvironmentSchema>;
//# sourceMappingURL=environment.schemas.d.ts.map