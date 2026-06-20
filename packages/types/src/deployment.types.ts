export type DeploymentStatus = 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled';

export interface DeploymentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  environmentId: string;
  organizationId: string;
  status: DeploymentStatus;
  commitHash: string | null;
  commitMessage: string | null;
  branch: string | null;
  triggeredBy: string; // userId or apiKeyId
  duration: number | null; // in milliseconds
  logs: DeploymentLog[];
  createdAt: string;
  updatedAt: string;
}
