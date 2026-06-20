import { z } from 'zod';
export declare const inviteMemberSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<["admin", "member", "viewer"]>>;
}, "strip", z.ZodTypeAny, {
    email: string;
    role: "admin" | "member" | "viewer";
}, {
    email: string;
    role?: "admin" | "member" | "viewer" | undefined;
}>;
export declare const updateMemberRoleSchema: z.ZodObject<{
    role: z.ZodEnum<["admin", "member", "viewer"]>;
}, "strip", z.ZodTypeAny, {
    role: "admin" | "member" | "viewer";
}, {
    role: "admin" | "member" | "viewer";
}>;
export declare const assignProjectMemberSchema: z.ZodObject<{
    userId: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<["admin", "developer", "viewer"]>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    role: "admin" | "viewer" | "developer";
}, {
    userId: string;
    role?: "admin" | "viewer" | "developer" | undefined;
}>;
export declare const updateProjectMemberRoleSchema: z.ZodObject<{
    role: z.ZodEnum<["admin", "developer", "viewer"]>;
}, "strip", z.ZodTypeAny, {
    role: "admin" | "viewer" | "developer";
}, {
    role: "admin" | "viewer" | "developer";
}>;
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;
export type AssignProjectMemberDto = z.infer<typeof assignProjectMemberSchema>;
export type UpdateProjectMemberRoleDto = z.infer<typeof updateProjectMemberRoleSchema>;
//# sourceMappingURL=member.schemas.d.ts.map