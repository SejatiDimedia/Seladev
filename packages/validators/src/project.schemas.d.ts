import { z } from 'zod';
export declare const createProjectSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    visibility: z.ZodDefault<z.ZodEnum<["private", "internal"]>>;
    repositoryUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    visibility: "private" | "internal";
    tags: string[];
    repositoryUrl?: string | null | undefined;
}, {
    name: string;
    description?: string | undefined;
    visibility?: "private" | "internal" | undefined;
    repositoryUrl?: string | null | undefined;
    tags?: string[] | undefined;
}>;
export declare const updateProjectSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodDefault<z.ZodOptional<z.ZodString>>>;
    visibility: z.ZodOptional<z.ZodDefault<z.ZodEnum<["private", "internal"]>>>;
    repositoryUrl: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    tags: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    description?: string | undefined;
    visibility?: "private" | "internal" | undefined;
    repositoryUrl?: string | null | undefined;
    tags?: string[] | undefined;
}, {
    name?: string | undefined;
    description?: string | undefined;
    visibility?: "private" | "internal" | undefined;
    repositoryUrl?: string | null | undefined;
    tags?: string[] | undefined;
}>;
export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
//# sourceMappingURL=project.schemas.d.ts.map