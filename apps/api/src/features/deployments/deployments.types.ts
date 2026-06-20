import type { Deployment, DeploymentStatus } from '@seladev/types';

export interface DeploymentFilters {
  environmentId?: string;
  status?: DeploymentStatus;
}

export interface DeploymentHistoryResponse {
  deployments: Deployment[];
  nextCursor: string | null;
  hasNext: boolean;
}
