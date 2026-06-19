# RBAC Design — SELADEV IDP

**Document type:** Architecture Design  
**Status:** Approved  
**Last updated:** 2026-06-19  
**Authors:** Platform Engineering  
**Cross-references:** [auth-design.md](./auth-design.md) · [api-design.md](./api-design.md) · [database-design.md](./database-design.md) · [audit-design.md](./audit-design.md)

---

## 1. Purpose

This document defines the Role-Based Access Control (RBAC) model for SELADEV — a multi-tenant Internal Developer Platform. It covers the two-tier role hierarchy, permission string conventions, enforcement architecture, caching strategy, API key scope interactions, and frontend integration.

**Audience:** Backend engineers, security engineers, frontend engineers implementing permission-gated UI, and platform operators managing tenant access.

---

## 2. Context

### Why RBAC for a Multi-Tenant IDP?

SELADEV is multi-tenant at the **organization** level. Every resource (project, environment, secret, deployment, webhook) is scoped under an org. Within an org, projects are discrete units of deployment and configuration — each with its own team membership.

A flat permission model (e.g., `admin` / `non-admin`) fails for IDPs because:

- **Org-level concerns** (billing, member invitations, API key issuance) must be governed separately from project-level concerns (deploying a service, reading a secret).
- **Least-privilege** is a hard security requirement — a developer working on Project A must not be able to read secrets for Project B even within the same org.
- **Audit compliance** demands that every action be traceable to an actor with a verifiable role at the time of the action.
- **API key access** must be constrained to explicit scopes rather than inheriting the issuing user's full permissions.

The two-tier model (org roles + project roles) is the minimum viable model that satisfies these requirements without the operational overhead of full ABAC policy engines.

---

## 3. Decisions

| Decision | Rationale |
|---|---|
| Two-tier RBAC (org + project) | Matches IDP multi-project structure; simpler than flat ABAC to operate |
| Permission strings use `resource:action` format | Self-documenting, grep-able in code, easy to extend |
| Effective permissions computed at request time + Redis cached | Avoids N+1 DB lookups per request; TTL-based invalidation keeps it correct |
| Middleware-first enforcement with service-layer defense | Defense in depth; middleware catches the common case, service catches edge cases |
| Org `owner` role is immutable and non-delegatable | Prevents privilege escalation and orphaned organizations |
| RBAC state stored in `memberships` collection | Single source of truth per tenant; no permission denormalization across collections |

---

## 4. Two-Tier RBAC Model

```
┌─────────────────────────────────────────────────────────────┐
│                      ORGANIZATION                           │
│                                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│   │  owner   │  │  admin   │  │  member  │  │  viewer  │  │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│   ┌────────────────────────────────────────────────────┐   │
│   │                    PROJECT                         │   │
│   │                                                    │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │   │
│   │  │project:admin │  │project:devlp │  │project: │  │   │
│   │  │              │  │              │  │ viewer  │  │   │
│   │  └──────────────┘  └──────────────┘  └─────────┘  │   │
│   └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

A user always has exactly one **org-level role** for a given organization. They may additionally hold a **project-level role** for zero or more projects within that org. Org-level roles gate access to org-wide APIs. Project-level roles gate access to project-scoped APIs.

---

## 5. Role Definitions

### 5.1 Organization Roles

#### `owner`
Assigned to the organization creator. There is exactly one owner per organization at all times. The owner cannot be removed or have their role changed unless ownership is explicitly transferred. An owner can delete the organization.

**Capabilities:**
- All `admin` capabilities
- Transfer ownership to another `admin` or `member`
- Delete the organization permanently
- Restore a suspended organization
- Manage billing and subscription

#### `admin`
Elevated trust within the organization. Typically assigned to team leads and platform engineers.

**Capabilities:**
- All `member` capabilities
- Invite and remove members from the organization
- Change any member's org role (except `owner`)
- Create, archive, and delete any project
- Manage org-level API keys and webhooks
- View and manage all project memberships
- Access audit logs for the full organization

#### `member`
The default role assigned upon accepting an invitation. Represents a trusted contributor.

**Capabilities:**
- Create projects (becomes `project:admin` of the created project automatically)
- View the organization member directory
- Request membership in projects they do not belong to
- View their own membership details

#### `viewer`
Read-only access to the organization. Typically used for external stakeholders, contractors, or auditors who need visibility without action capability.

**Capabilities:**
- View the org member directory (names and roles only, no email unless own profile)
- View project names and metadata (no secrets, no deployment logs)
- No write, update, or delete capability anywhere

---

### 5.2 Project Roles

Project roles are scoped strictly to a single project. They stack on top of the user's org role — an org `admin` automatically receives `project:admin` permissions on all projects without requiring an explicit project-level membership entry.

#### `project:admin`
Full control over a specific project.

**Capabilities:**
- All `project:developer` capabilities
- Manage project member list (invite, remove, change project roles)
- Create, update, delete environments
- Manage project-level webhooks
- Archive or delete the project (subject to org admin approval if not org:admin)
- Rotate deployment secrets and environment-level API keys
- View project audit logs

#### `project:developer`
The standard role for contributors who deploy and manage configuration.

**Capabilities:**
- Trigger and cancel deployments
- View deployment logs and history
- Create, read, update, and delete secrets/env vars (per-environment)
- View project webhooks (no create/delete)
- View project members

#### `project:viewer`
Read-only access within a specific project.

**Capabilities:**
- View deployments and deployment status
- View environment names (no secret values)
- View project members
- No write capability anywhere within the project

---

## 6. Permission Matrix

The following table enumerates all platform actions against all roles. `✓` = permitted, `—` = denied.

> **Key:** `o:owner`, `o:admin`, `o:member`, `o:viewer`, `p:admin`, `p:dev`, `p:view`

| Action | o:owner | o:admin | o:member | o:viewer | p:admin | p:dev | p:view |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Organization** | | | | | | | |
| `org:read` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `org:update` | ✓ | ✓ | — | — | — | — | — |
| `org:delete` | ✓ | — | — | — | — | — | — |
| `org:transfer_ownership` | ✓ | — | — | — | — | — | — |
| `org:manage_billing` | ✓ | — | — | — | — | — | — |
| **Members** | | | | | | | |
| `member:invite` | ✓ | ✓ | — | — | — | — | — |
| `member:remove` | ✓ | ✓ | — | — | — | — | — |
| `member:list` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `member:change_role` | ✓ | ✓ | — | — | — | — | — |
| **Projects** | | | | | | | |
| `project:create` | ✓ | ✓ | ✓ | — | — | — | — |
| `project:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project:update` | ✓ | ✓ | — | — | ✓ | — | — |
| `project:delete` | ✓ | ✓ | — | — | — | — | — |
| `project:archive` | ✓ | ✓ | — | — | ✓ | — | — |
| **Project Members** | | | | | | | |
| `project_member:invite` | ✓ | ✓ | — | — | ✓ | — | — |
| `project_member:remove` | ✓ | ✓ | — | — | ✓ | — | — |
| `project_member:list` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `project_member:change_role` | ✓ | ✓ | — | — | ✓ | — | — |
| **Environments** | | | | | | | |
| `environment:create` | ✓ | ✓ | — | — | ✓ | — | — |
| `environment:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `environment:update` | ✓ | ✓ | — | — | ✓ | — | — |
| `environment:delete` | ✓ | ✓ | — | — | ✓ | — | — |
| **Secrets** | | | | | | | |
| `secret:create` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `secret:read` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `secret:update` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `secret:delete` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `secret:rotate` | ✓ | ✓ | — | — | ✓ | — | — |
| **Deployments** | | | | | | | |
| `deployment:trigger` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `deployment:cancel` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `deployment:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `deployment:read_logs` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| **API Keys** | | | | | | | |
| `api_key:create` | ✓ | ✓ | — | — | ✓ | — | — |
| `api_key:revoke` | ✓ | ✓ | — | — | ✓ | — | — |
| `api_key:list` | ✓ | ✓ | — | — | ✓ | — | — |
| **Webhooks** | | | | | | | |
| `webhook:create` | ✓ | ✓ | — | — | ✓ | — | — |
| `webhook:read` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `webhook:update` | ✓ | ✓ | — | — | ✓ | — | — |
| `webhook:delete` | ✓ | ✓ | — | — | ✓ | — | — |
| **Audit Logs** | | | | | | | |
| `audit_log:read` | ✓ | ✓ | — | — | ✓ | — | — |

---

## 7. Permission String Convention

All permissions follow the `resource:action` format. This format is used:
- In middleware `authorizeRBAC(permission)` calls
- As API key scope values
- In audit log `action` fields
- In frontend `usePermission(permission)` hook calls

```ts
// Exhaustive TypeScript union type for all platform permissions
type Permission =
  // org
  | 'org:read' | 'org:update' | 'org:delete' | 'org:transfer_ownership' | 'org:manage_billing'
  // member
  | 'member:invite' | 'member:remove' | 'member:list' | 'member:change_role'
  // project
  | 'project:create' | 'project:read' | 'project:update' | 'project:delete' | 'project:archive'
  // project member
  | 'project_member:invite' | 'project_member:remove' | 'project_member:list' | 'project_member:change_role'
  // environment
  | 'environment:create' | 'environment:read' | 'environment:update' | 'environment:delete'
  // secret
  | 'secret:create' | 'secret:read' | 'secret:update' | 'secret:delete' | 'secret:rotate'
  // deployment
  | 'deployment:trigger' | 'deployment:cancel' | 'deployment:read' | 'deployment:read_logs'
  // api key
  | 'api_key:create' | 'api_key:revoke' | 'api_key:list'
  // webhook
  | 'webhook:create' | 'webhook:read' | 'webhook:update' | 'webhook:delete'
  // audit
  | 'audit_log:read';
```

**Naming conventions:**
- Resources are `snake_case` nouns (plural concepts, singular naming): `api_key`, `project_member`
- Actions are `snake_case` verbs: `read`, `create`, `update`, `delete`, `trigger`, `cancel`, `rotate`
- No wildcards (`resource:*`) in enforced permissions — each action must be explicitly granted
- Wildcards are only used internally to derive org role permission sets

---

## 8. Effective Role Resolution

### 8.1 Resolution Algorithm

Effective permissions for a request are computed using the following precedence rules:

```
effectivePermissions = orgRolePermissions(user.orgRole)
                     ∪ projectRolePermissions(user.projectRole, projectId)
```

Org role permissions are **always additive** on top of project role permissions. An org `admin` always has `project:admin` effective permissions on every project within their org, even without an explicit project membership entry.

```
┌─────────────────────────────────────────────────────────────┐
│            EFFECTIVE PERMISSION RESOLUTION                  │
│                                                             │
│  1. Look up user.orgRole for the request's orgId            │
│  2. If orgRole ∈ {owner, admin}:                            │
│       → Grant all project-scoped permissions for all         │
│         projects within this org                            │
│     Else:                                                   │
│       → Look up user.projectRole for the request's          │
│         projectId (may be undefined)                        │
│  3. Merge org permissions ∪ project permissions              │
│  4. If user.suspended == true → deny all                     │
│  5. If org.suspended == true → deny all except org:read     │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 TypeScript Implementation

```ts
// packages/shared/src/rbac/permissions.ts

const ORG_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: [
    'org:read', 'org:update', 'org:delete', 'org:transfer_ownership', 'org:manage_billing',
    'member:invite', 'member:remove', 'member:list', 'member:change_role',
    'project:create', 'project:read', 'project:update', 'project:delete', 'project:archive',
    'project_member:invite', 'project_member:remove', 'project_member:list', 'project_member:change_role',
    'environment:create', 'environment:read', 'environment:update', 'environment:delete',
    'secret:create', 'secret:read', 'secret:update', 'secret:delete', 'secret:rotate',
    'deployment:trigger', 'deployment:cancel', 'deployment:read', 'deployment:read_logs',
    'api_key:create', 'api_key:revoke', 'api_key:list',
    'webhook:create', 'webhook:read', 'webhook:update', 'webhook:delete',
    'audit_log:read',
  ],
  admin: [
    'org:read', 'org:update',
    'member:invite', 'member:remove', 'member:list', 'member:change_role',
    'project:create', 'project:read', 'project:update', 'project:delete', 'project:archive',
    'project_member:invite', 'project_member:remove', 'project_member:list', 'project_member:change_role',
    'environment:create', 'environment:read', 'environment:update', 'environment:delete',
    'secret:create', 'secret:read', 'secret:update', 'secret:delete', 'secret:rotate',
    'deployment:trigger', 'deployment:cancel', 'deployment:read', 'deployment:read_logs',
    'api_key:create', 'api_key:revoke', 'api_key:list',
    'webhook:create', 'webhook:read', 'webhook:update', 'webhook:delete',
    'audit_log:read',
  ],
  member: [
    'org:read',
    'member:list',
    'project:create', 'project:read',
    'project_member:list',
    'environment:read',
    'deployment:read',
  ],
  viewer: [
    'org:read',
    'member:list',
    'project:read',
    'environment:read',
    'deployment:read',
  ],
};

const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  'project:admin': [
    'project:read', 'project:update', 'project:archive',
    'project_member:invite', 'project_member:remove', 'project_member:list', 'project_member:change_role',
    'environment:create', 'environment:read', 'environment:update', 'environment:delete',
    'secret:create', 'secret:read', 'secret:update', 'secret:delete', 'secret:rotate',
    'deployment:trigger', 'deployment:cancel', 'deployment:read', 'deployment:read_logs',
    'api_key:create', 'api_key:revoke', 'api_key:list',
    'webhook:create', 'webhook:read', 'webhook:update', 'webhook:delete',
    'audit_log:read',
  ],
  'project:developer': [
    'project:read',
    'project_member:list',
    'environment:read',
    'secret:create', 'secret:read', 'secret:update', 'secret:delete',
    'deployment:trigger', 'deployment:cancel', 'deployment:read', 'deployment:read_logs',
    'webhook:read',
  ],
  'project:viewer': [
    'project:read',
    'project_member:list',
    'environment:read',
    'deployment:read',
  ],
};

export function resolveEffectivePermissions(
  orgRole: OrgRole,
  projectRole: ProjectRole | undefined,
): Set<Permission> {
  const perms = new Set<Permission>(ORG_ROLE_PERMISSIONS[orgRole]);
  if (projectRole) {
    for (const p of PROJECT_ROLE_PERMISSIONS[projectRole]) {
      perms.add(p);
    }
  }
  return perms;
}

export function hasPermission(
  orgRole: OrgRole,
  projectRole: ProjectRole | undefined,
  required: Permission,
): boolean {
  return resolveEffectivePermissions(orgRole, projectRole).has(required);
}
```

---

## 9. RBAC Enforcement Architecture

### 9.1 Defense in Depth

RBAC enforcement happens at three layers. Each layer is independently capable of rejecting unauthorized requests. No single layer is relied upon exclusively.

```
HTTP Request
    │
    ▼
┌───────────────────────────────────────┐
│         Layer 1: Middleware           │  ← authenticate + authorizeRBAC
│  (Express route middleware chain)     │
└───────────────────────────────────────┘
    │ passes context: {user, orgRole, projectRole}
    ▼
┌───────────────────────────────────────┐
│         Layer 2: Service Layer        │  ← re-validates for sensitive ops
│  (business logic, ownership checks)  │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│       Layer 3: Repository Layer       │  ← scoped queries (tenantId filter)
│  (MongoDB queries always org-scoped) │
└───────────────────────────────────────┘
```

**Layer 1 — Middleware** catches the overwhelming majority of unauthorized requests before they touch business logic. This is the performance-sensitive path.

**Layer 2 — Service** re-validates when an action's safety depends on runtime data unavailable at middleware time (e.g., "is this user the last admin of the org?").

**Layer 3 — Repository** ensures all MongoDB queries include `{ orgId }` as a mandatory filter, preventing cross-tenant data leakage even if Layers 1 and 2 are bypassed.

### 9.2 Middleware Implementation

```ts
// apps/api/src/middleware/authorizeRBAC.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors';
import { resolveEffectivePermissions } from '@seladev/shared/rbac';
import { getRBACContext } from '../middleware/authenticate.middleware';

/**
 * Middleware factory. Usage:
 *   router.delete('/projects/:id', authenticate, authorizeRBAC('project:delete'), handler)
 */
export function authorizeRBAC(required: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ctx = getRBACContext(req); // { userId, orgId, orgRole, projectId?, projectRole? }

    if (!ctx) {
      return next(new ForbiddenError('No RBAC context available'));
    }

    if (ctx.suspended) {
      return next(new ForbiddenError('User account is suspended'));
    }

    const allowed = resolveEffectivePermissions(ctx.orgRole, ctx.projectRole).has(required);

    if (!allowed) {
      return next(
        new ForbiddenError(`Permission denied: ${required}`, {
          userId: ctx.userId,
          orgId: ctx.orgId,
          required,
          orgRole: ctx.orgRole,
          projectRole: ctx.projectRole,
        }),
      );
    }

    next();
  };
}
```

### 9.3 RBAC Context Population

The `authenticate` middleware runs before `authorizeRBAC`. It:
1. Validates the JWT (RS256, checks `exp`, `iss`, `aud`)
2. Looks up the user's `OrgMembership` document (Redis cache → MongoDB fallback)
3. If `projectId` is present in route params, looks up `ProjectMembership`
4. Attaches `RBACContext` to `req` via `req.rbac`

```ts
interface RBACContext {
  userId: ObjectId;
  orgId: ObjectId;
  orgRole: OrgRole;
  projectId?: ObjectId;
  projectRole?: ProjectRole;
  suspended: boolean;
  apiKeyId?: ObjectId;        // set when request authenticated via API key
  apiKeyScopes?: Permission[]; // intersection-enforced (see §11)
}
```

### 9.4 Route-Level Usage

```ts
// apps/api/src/features/secrets/secrets.router.ts

router.get(
  '/orgs/:orgId/projects/:projectId/secrets',
  authenticate,
  authorizeRBAC('secret:read'),
  secretsController.listSecrets,
);

router.post(
  '/orgs/:orgId/projects/:projectId/secrets/:secretId/rotate',
  authenticate,
  authorizeRBAC('secret:rotate'),
  secretsController.rotateSecret,
);
```

---

## 10. RBAC Caching Strategy

### 10.1 Cache Design

RBAC context lookups (membership documents) are the hottest read path in the API. Every authenticated request triggers at least one membership lookup. Without caching, this creates N database reads per second at scale.

**Cache backend:** Redis (Upstash Redis in production, local Redis in development)  
**Cache key format:**

```
rbac:{userId}:{orgId}            → OrgMembership (role, suspended status)
rbac:{userId}:{orgId}:{projectId} → ProjectMembership (project role)
```

**TTL:** 5 minutes (300 seconds). Chosen as a balance between:
- Freshness: role changes take effect within 5 minutes without user action
- Performance: eliminates >95% of membership DB reads under normal traffic

### 10.2 Cache Invalidation

Cache entries are invalidated on all write operations that affect membership:

```ts
// apps/api/src/features/members/members.service.ts

async changeOrgRole(userId: ObjectId, orgId: ObjectId, newRole: OrgRole): Promise<void> {
  await this.membershipRepo.updateOrgRole(userId, orgId, newRole);
  await this.rbacCache.invalidate(`rbac:${userId}:${orgId}`);
  // Also invalidate all project-level entries for this user in this org
  await this.rbacCache.invalidatePattern(`rbac:${userId}:${orgId}:*`);
  await this.auditService.log({ actor: this.ctx.userId, action: 'member:change_role', ... });
}
```

**Events that trigger cache invalidation:**
- Org role change (`member:change_role`)
- Project role change (`project_member:change_role`)
- Member removed from org or project
- User suspended / unsuspended
- Ownership transferred
- Project deleted or archived

### 10.3 Cache Warming

Cache entries are written proactively on login (the JWT exchange already requires a membership lookup, so the result is stored in Redis before the first API call). This eliminates cold-start latency for the most common session patterns.

---

## 11. API Key Scope Enforcement

API keys are issued with explicit scopes. When a request is authenticated via API key rather than JWT, the effective permissions are computed as:

```
effectivePermissions = resolveEffectivePermissions(apiKey.orgRole, apiKey.projectRole)
                     ∩ apiKey.scopes
```

The intersection ensures that:
- An API key can never have more permissions than the issuing user had at the time of creation
- An API key can have fewer permissions than the issuing user's role grants (scoped down for CI/CD tokens, etc.)

```ts
// During API key authentication, scope intersection is enforced:
if (ctx.apiKeyScopes) {
  const scopeSet = new Set(ctx.apiKeyScopes);
  ctx.effectivePermissions = new Set(
    [...resolveEffectivePermissions(ctx.orgRole, ctx.projectRole)].filter(p => scopeSet.has(p))
  );
}
```

**API key scope examples:**

```json
// CI/CD deployment key — can only trigger deployments and read secrets
{ "scopes": ["deployment:trigger", "deployment:read", "secret:read"] }

// Monitoring integration — read-only
{ "scopes": ["deployment:read", "audit_log:read"] }

// Webhook management bot
{ "scopes": ["webhook:create", "webhook:read", "webhook:update", "webhook:delete"] }
```

API key scopes are stored in the `ApiKey` document and displayed in the SELADEV dashboard at creation time. Scopes cannot be expanded after issuance; the key must be rotated to gain additional scopes.

---

## 12. Frontend RBAC

### 12.1 Philosophy: UX vs Security Separation

Frontend RBAC is **UX-only**. It controls what the user sees — hiding buttons, disabling actions, and suppressing navigation items. It is **not** a security boundary. All security is enforced server-side.

This separation means:
- Frontend permission checks can be optimistic — they can use cached role data without TTL concerns
- A bug in frontend permission rendering never creates a security vulnerability
- Frontend permission state is derived from the `/auth/me` response, which includes the user's resolved role context

### 12.2 `usePermission` Hook

```ts
// apps/web/src/hooks/usePermission.ts

import { useAuthStore } from '@/stores/auth.store';
import { resolveEffectivePermissions } from '@seladev/shared/rbac';

export function usePermission(required: Permission): boolean {
  const { orgRole, projectRole } = useAuthStore();
  return resolveEffectivePermissions(orgRole, projectRole).has(required);
}

// Usage in components:
const canCreateSecret = usePermission('secret:create');
const canTriggerDeployment = usePermission('deployment:trigger');
```

### 12.3 Permission-Gated Components

```tsx
// apps/web/src/components/PermissionGate.tsx

interface PermissionGateProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const allowed = usePermission(permission);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

// Usage:
<PermissionGate permission="secret:create">
  <Button onClick={handleCreate}>Add Secret</Button>
</PermissionGate>

<PermissionGate
  permission="deployment:trigger"
  fallback={<Tooltip content="Insufficient permissions"><Button disabled>Deploy</Button></Tooltip>}
>
  <Button onClick={handleDeploy}>Deploy</Button>
</PermissionGate>
```

### 12.4 Route-Level Guards

```ts
// apps/web/src/router/guards.ts

export function requirePermission(permission: Permission): RouteGuard {
  return () => {
    const { orgRole, projectRole } = useAuthStore.getState();
    const allowed = resolveEffectivePermissions(orgRole, projectRole).has(permission);
    if (!allowed) {
      return redirect('/dashboard?error=forbidden');
    }
    return null;
  };
}

// In router definition:
{
  path: '/settings/members',
  loader: requirePermission('member:invite'),
  element: <MembersSettingsPage />,
}
```

---

## 13. Edge Cases

### 13.1 User Suspended

When a user is suspended by an org admin:
1. The `OrgMembership.suspended` flag is set to `true`
2. The Redis RBAC cache entry for that user is immediately invalidated
3. Any active JWTs remain technically valid until expiry (15-minute access token TTL)
4. The `authorizeRBAC` middleware checks `ctx.suspended` before permission resolution and returns `403` for all requests
5. The refresh token endpoint checks suspension status before issuing new access tokens, effectively blocking re-auth within seconds

> **Design note:** The 15-minute window during which a suspended user's access token remains valid is an acceptable tradeoff against the cost of a token blocklist. For high-security scenarios (e.g., security incident response), admins can trigger a forced logout via `POST /orgs/:orgId/members/:userId/force-logout`, which adds the JWT `jti` to a Redis blocklist.

### 13.2 Org Owner Leaving

An org owner cannot leave or be removed from an organization without first transferring ownership:

```ts
// apps/api/src/features/members/members.service.ts

async removeMember(targetUserId: ObjectId, orgId: ObjectId): Promise<void> {
  const membership = await this.membershipRepo.findOne(targetUserId, orgId);
  if (membership.role === 'owner') {
    throw new ValidationError('Cannot remove org owner. Transfer ownership first.');
  }
  // ...
}
```

### 13.3 Last Admin Constraint

If an org has only one `admin` (and no `owner` — which should never happen by design), removing them is blocked:

```ts
async changeOrgRole(targetUserId: ObjectId, orgId: ObjectId, newRole: OrgRole): Promise<void> {
  if (newRole !== 'admin') {
    const adminCount = await this.membershipRepo.countByRole(orgId, 'admin');
    const currentRole = await this.membershipRepo.getRole(targetUserId, orgId);
    if (currentRole === 'admin' && adminCount === 1) {
      throw new ValidationError('Cannot demote the last admin. Promote another member first.');
    }
  }
  // ...
}
```

### 13.4 Project Created by Departing Member

When a `member` creates a project, they are assigned `project:admin` automatically. If that member is subsequently removed from the org:
1. Their org membership is deleted
2. Their project membership is cascade-deleted
3. If no other `project:admin` exists, the org `admin` is notified via email and in-app notification
4. The project is not deleted — it remains accessible to org admins

### 13.5 Cross-Tenant Access Attempts

All MongoDB repository methods include a mandatory `orgId` filter. A request that provides a valid `projectId` from a different org will fail at the repository layer with a 404 (not 403, to avoid leaking org structure to potential attackers).

---

## 14. Audit Trail for Permission Changes

All RBAC mutations are written to the `auditLogs` collection. The audit log entry for a permission change includes:

```json
{
  "_id": "...",
  "orgId": "...",
  "actor": {
    "userId": "...",
    "email": "alice@acme.com",
    "orgRole": "admin"
  },
  "action": "member:change_role",
  "resource": {
    "type": "member",
    "id": "...",
    "email": "bob@acme.com"
  },
  "metadata": {
    "previousRole": "member",
    "newRole": "admin",
    "projectId": null
  },
  "ipAddress": "203.0.113.42",
  "userAgent": "Mozilla/5.0 ...",
  "timestamp": "2026-06-19T12:34:56.789Z"
}
```

Audit log entries are **immutable** — no update or delete operations are permitted on the `auditLogs` collection. See [audit-design.md](./audit-design.md) for the full audit log schema and retention policy.

---

## 15. Tradeoffs

| Option Considered | Decision | Reason Rejected / Accepted |
|---|---|---|
| Single-tier RBAC (org role only) | Rejected | Cannot enforce project-level isolation within the same org |
| Full ABAC with policy engine | Rejected (for now) | Operational overhead unjustified at current scale; RBAC covers 95% of use cases |
| Storing effective permissions in JWT | Rejected | Stale permissions; role changes wouldn't take effect until token expiry |
| Per-request DB lookup (no cache) | Rejected | ~5ms per lookup × high request volume = unacceptable p99 latency |
| 1-hour cache TTL | Rejected | Role changes take too long to propagate in security-sensitive scenarios |
| 1-minute cache TTL | Rejected | Too much DB pressure at scale; doesn't meaningfully improve security |
| 5-minute cache TTL | **Accepted** | Balances freshness with performance; matches typical token-refresh window |

---

## 16. Future Improvements

### 16.1 Attribute-Based Access Control (ABAC)

The current model cannot express conditions like "a developer can only trigger deployments during business hours" or "viewers from external contractors can only access non-production environments." These require attribute-based policies.

**Migration path:** The `resolveEffectivePermissions` function is designed as a single point of policy resolution. An ABAC engine (e.g., OPA — Open Policy Agent) can be dropped in as a replacement resolver, reading the same `RBACContext` and returning the same `Set<Permission>` shape.

### 16.2 OPA Integration

```ts
// Future: replace local resolution with OPA sidecar
async function resolveEffectivePermissionsOPA(ctx: RBACContext): Promise<Set<Permission>> {
  const response = await opaClient.evaluate('seladev/authz/allow', { input: ctx });
  return new Set(response.permissions);
}
```

### 16.3 Role Templates

Allow org admins to define custom roles (e.g., `release-engineer`) as a named subset of permissions from the `project:admin` permission set. This avoids needing full ABAC for the common case of custom permission bundles.

### 16.4 Conditional Access Policies

Enforce MFA for all `admin` and `owner` actions. Block access from IP ranges not on an allowlist. These can be implemented as additional checks in the `authorizeRBAC` middleware chain without changing the core RBAC model.

### 16.5 Permission Expansion Alerts

Emit a `permission.elevated` audit event and Slack notification any time a user's role is raised (e.g., `viewer → admin`). This supports security monitoring pipelines.
