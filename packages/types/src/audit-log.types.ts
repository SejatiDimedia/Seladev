export interface AuditLog {
  id: string;
  organizationId: string;
  projectId: string | null;
  actor: {
    userId: string | null; // null for system/API key events
    email: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
  action: string;
  resource: {
    type: string; // 'secret' | 'project' | 'deployment' | 'auth' | 'org' | 'member' | 'apiKey'
    id: string;
    name: string; // Denormalized name
  };
  metadata: Record<string, unknown> | null;
  outcome: 'success' | 'failure';
  createdAt: string;
}
