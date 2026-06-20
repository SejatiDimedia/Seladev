import { z } from 'zod';
export declare const createWebhookSchema: z.ZodObject<{
    name: z.ZodString;
    url: z.ZodString;
    events: z.ZodArray<z.ZodString, "many">;
    projectId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    url: string;
    events: string[];
    projectId?: string | null | undefined;
}, {
    name: string;
    url: string;
    events: string[];
    projectId?: string | null | undefined;
}>;
export declare const updateWebhookSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    events: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    projectId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
} & {
    isActive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    isActive?: boolean | undefined;
    name?: string | undefined;
    url?: string | undefined;
    events?: string[] | undefined;
    projectId?: string | null | undefined;
}, {
    isActive?: boolean | undefined;
    name?: string | undefined;
    url?: string | undefined;
    events?: string[] | undefined;
    projectId?: string | null | undefined;
}>;
export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;
//# sourceMappingURL=webhook.schemas.d.ts.map