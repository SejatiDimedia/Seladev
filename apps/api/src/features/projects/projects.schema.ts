import { z } from 'zod';
import { 
  createProjectSchema, 
  updateProjectSchema, 
  createEnvironmentSchema, 
  updateEnvironmentSchema, 
  assignProjectMemberSchema, 
  updateProjectMemberRoleSchema 
} from '@seladev/validators';

export const updateEnvironmentVariablesSchema = z.object({
  variables: z.array(
    z.object({
      key: z.string().min(1, 'Key is required').trim(),
      value: z.string(),
      isSecret: z.boolean().default(false),
    })
  ),
});

export {
  createProjectSchema,
  updateProjectSchema,
  createEnvironmentSchema,
  updateEnvironmentSchema,
  assignProjectMemberSchema,
  updateProjectMemberRoleSchema
};

