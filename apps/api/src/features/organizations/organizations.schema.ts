import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be under 100 characters').trim(),
  slug: z.string().min(3, 'Slug must be at least 3 characters').max(50, 'Slug must be under 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase, alphanumeric, and hyphens only')
    .trim(),
});

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export {
  inviteMemberSchema,
  updateMemberRoleSchema,
  type InviteMemberDto,
  type UpdateMemberRoleDto
} from '@seladev/validators';
