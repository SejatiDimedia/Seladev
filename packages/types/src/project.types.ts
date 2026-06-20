import type { ProjectRole } from './rbac.types';

export interface ProjectSettings {
  deploymentProtection: boolean;
  requireApproval: boolean;
  allowedBranches: string[];
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  visibility: 'private' | 'internal';
  repositoryUrl: string | null;
  tags: string[];
  settings: ProjectSettings;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
}
