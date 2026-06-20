import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address').trim().toLowerCase(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']),
});

export const assignProjectMemberSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(['admin', 'developer', 'viewer']).default('developer'),
});

export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(['admin', 'developer', 'viewer']),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;
export type AssignProjectMemberDto = z.infer<typeof assignProjectMemberSchema>;
export type UpdateProjectMemberRoleDto = z.infer<typeof updateProjectMemberRoleSchema>;
