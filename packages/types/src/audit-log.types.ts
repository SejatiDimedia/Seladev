import type { OrgRole } from './rbac.types';

export interface AuditLog {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorId: string; // userId or apiKeyId
  actorEmail: string;
  actorRole: OrgRole | 'system' | string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
