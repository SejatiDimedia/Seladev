export type DeploymentStatus =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'pending_approval';

export interface StatusEvent {
  status: DeploymentStatus;
  timestamp: string;
  message: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  environmentId: string;
  organizationId: string;
  version: string;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  status: DeploymentStatus;
  statusHistory: StatusEvent[];
  triggeredBy: string;
  triggeredVia: 'ui' | 'api' | 'webhook' | 'schedule';
  buildLogs: string[];
  duration: number | null; // in milliseconds
  errorMessage: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}
