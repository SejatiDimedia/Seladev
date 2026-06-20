import type { Secret } from '@seladev/types';
import type { CreateSecretDto, UpdateSecretDto } from '@seladev/validators';

export interface SecretVersionResponse {
  id: string;
  secretId: string;
  organizationId: string;
  version: number;
  createdBy: string;
  createdAt: string;
}

export type {
  Secret,
  CreateSecretDto,
  UpdateSecretDto,
};
