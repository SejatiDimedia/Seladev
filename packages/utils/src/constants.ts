export const PLAN_LIMITS = {
  free: {
    maxProjects: 3,
    maxMembers: 5,
  },
  pro: {
    maxProjects: 20,
    maxMembers: 30,
  },
  enterprise: {
    maxProjects: 999,
    maxMembers: 999,
  },
} as const;

export const DEFAULT_SCOPES = [
  'projects:read',
  'projects:write',
  'environments:read',
  'environments:write',
  'secrets:read',
  'secrets:write',
  'api-keys:read',
  'api-keys:write',
  'deployments:read',
  'deployments:write',
  'webhooks:read',
  'webhooks:write',
  'audit-logs:read',
  'members:read',
  'members:write',
] as const;

export const EVENT_TYPES = [
  'project.created',
  'project.updated',
  'project.deleted',
  'secret.created',
  'secret.updated',
  'secret.deleted',
  'secret.accessed',
  'api_key.created',
  'api_key.rotated',
  'api_key.revoked',
  'deployment.created',
  'deployment.started',
  'deployment.succeeded',
  'deployment.failed',
  'deployment.cancelled',
  'webhook.created',
  'webhook.updated',
  'webhook.deleted',
  'member.invited',
  'member.joined',
  'member.removed',
] as const;
