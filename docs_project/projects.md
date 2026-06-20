# Projects Module

**Document Type:** Feature Module Design  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the Projects module for SELADEV. A project is the primary unit of work within an organization — it groups environments, secrets, deployments, webhooks, and members around a single application or service. This document covers the project lifecycle, environment model, membership, settings, and the architectural decisions that make projects a safe and scalable bounded context.

---

## Context

Within an organization, engineering teams work on multiple applications simultaneously. The Projects module provides:

- **Bounded context** — a project encapsulates all resources for one application (frontend, API, mobile app, etc.)
- **Environment isolation** — each project contains its own `development`, `staging`, and `production` environments
- **Granular access control** — project-level roles allow fine-grained access independent of org-level roles
- **Cross-feature anchor** — secrets, deployments, and webhooks all reference `projectId` as their scope

---

## Project Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  name: string,
  slug: string,               // Unique within org. Immutable.
  description: string,
  visibility: 'private' | 'internal',
  repositoryUrl: string | null,
  tags: string[],             // User-defined labels for filtering
  settings: {
    deploymentProtection: boolean,  // Require manual approval for production deploys
    requireApproval: boolean,       // All deploys need reviewer sign-off
    allowedBranches: string[],      // Restrict deployments to specific branches
  },
  createdBy: ObjectId,
  archivedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}
```

See [`database-design.md`](database-design.md) for full indexing strategy.

---

## Project Lifecycle

### Creation

```
POST /api/v1/organizations/:slug/projects
{
  "name": "Payment API",
  "slug": "payment-api",          // optional, auto-generated from name
  "description": "Core payment processing service",
  "visibility": "private",
  "repositoryUrl": "https://github.com/acme/payment-api",
  "tags": ["backend", "critical"]
}
```

On creation:
1. Slug uniqueness validated within the organization (not globally — two orgs can have `payment-api`)
2. Project document created
3. Creating user added as `project:admin` via `projectMembers` collection
4. Three default environments created: `development`, `staging`, `production` (production is `isProtected: true`)
5. Audit log: `project.created`

Required org role: `admin` or `owner` (members cannot create projects).

### Slug Uniqueness

Project slugs are unique **per organization**, not globally. The compound index `{ organizationId: 1, slug: 1 }` enforces this:

```typescript
// Correct: two different orgs can both have 'payment-api'
acme-corp/projects/payment-api   ✓
beta-inc/projects/payment-api    ✓

// Error: same org cannot have two 'payment-api' projects
acme-corp/projects/payment-api   (exists)
acme-corp/projects/payment-api   → 409 CONFLICT
```

### Visibility

| Visibility | Who can see it |
|---|---|
| `private` | Only explicitly added project members |
| `internal` | All active members of the parent organization |

`private` is the default and recommended for most projects. `internal` is useful for shared configuration projects or open developer resources within the org.

### Archiving vs Deletion

Projects follow the same soft-delete pattern as organizations:

- **Archive** (`archivedAt` set): project hidden from lists, resources preserved, no new operations allowed
- **Hard delete**: runs via BullMQ job after 30-day grace period, cascades to environments, secrets, deployments, webhooks, audit logs

Only `project:admin`, org `admin`, or org `owner` can archive a project.

**Decision:** Hard deletion is intentionally async. Cascading deletion across 6+ collections synchronously within a request creates unacceptable latency and partial-failure risk. A BullMQ job handles this safely with idempotent steps and retry.

---

## Environments

Every project contains environments that provide isolated configuration contexts.

### Environment Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  name: string,               // 'development' | 'staging' | 'production' | custom
  slug: string,
  type: 'development' | 'staging' | 'production',
  isProtected: boolean,       // Requires elevated role for secret access/deployment
  variables: {                // Non-sensitive env vars (plain text)
    key: string,
    value: string,
    isSecret: boolean,        // If true, value is a reference key in secrets collection
  }[],
  createdAt: Date,
  updatedAt: Date,
}
```

### Default Environments

When a project is created, three environments are automatically provisioned:

| Environment | Type | isProtected | Notes |
|---|---|---|---|
| `development` | `development` | `false` | Open access for all project members |
| `staging` | `staging` | `false` | Open access for project:developer+ |
| `production` | `production` | `true` | Requires project:admin or org:admin |

### Protected Environments

When `isProtected: true`:
- Reading **secret values** requires `project:admin` or org `admin`/`owner`
- Triggering deployments requires `project:admin` or org `admin`/`owner`
- `project:developer` can read secret names (masked) but cannot decrypt values

This allows developers to work freely in `development`/`staging` without access to production credentials.

### Non-Secret Environment Variables

Non-sensitive configuration (feature flags, service URLs, non-secret config values) is stored directly in the environment document as an embedded array. This design:
- Avoids a separate collection for the common case
- Allows atomic updates to the full variable set
- Keeps "load all env vars for environment" as a single document read

Variables with `isSecret: true` store only a **reference key** (the secret name), never the value. The frontend resolves these on demand from the secrets API.

---

## Project Membership

Projects have their own membership model independent of org membership.

### projectMembers Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  userId: ObjectId,
  role: 'project:admin' | 'project:developer' | 'project:viewer',
  addedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date,
}
```

### Role Inheritance

Org-level roles always supersede project-level roles:

```
Effective role = max(orgRole, projectRole)

Examples:
- org:admin + no project membership  → acts as project:admin
- org:member + project:admin         → project:admin (project role wins within project)
- org:member + project:viewer        → project:viewer
- org:member + no project membership → cannot access private project
- org:viewer + project:admin         → project:admin (project role wins)
```

See [`rbac.md`](rbac.md) for the complete effective-role resolution algorithm.

### Invitation Flow

```
POST /api/v1/projects/:projectId/members
{
  "userId": "userId123",
  "role": "project:developer"
}
```

- Only project:admin or org:admin/owner can add members
- User must be an active org member before being added to a project
- Audit log: `project.member_added`

---

## Project Settings

```typescript
settings: {
  deploymentProtection: boolean,  // true → require manual approval before prod deploy starts
  requireApproval: boolean,       // true → all deploys (any env) need reviewer sign-off
  allowedBranches: string[],      // ['main', 'release/*'] → restrict by branch pattern
}
```

### Deployment Protection

When `deploymentProtection: true`:
- Deployments to `production` environment are queued in `pending_approval` state
- A `project:admin` or org admin must explicitly approve before the BullMQ worker picks up the job
- Approval/rejection recorded in `statusHistory` and audit log

### Branch Restrictions

`allowedBranches` uses glob patterns evaluated at deployment trigger time:

```typescript
// ['main', 'release/*', 'hotfix/*']
isAllowed('main')         → true
isAllowed('release/v2.1') → true
isAllowed('feature/xyz')  → false → 422 BUSINESS_RULE_VIOLATION
```

If `allowedBranches` is empty, no branch restriction is applied.

---

## Cross-Feature Dependencies

Projects are the anchor for multiple platform features:

```
Organization
  └── Project
        ├── Environments
        │     └── Secrets (scoped to environmentId)
        ├── Deployments (target environmentId within projectId)
        ├── Webhooks (scoped to projectId, optional)
        ├── API Keys (can be project-scoped or org-scoped)
        └── Project Members (projectId + userId + role)
```

**Deletion cascade order** (handled by BullMQ job):
1. Revoke all project-scoped API keys
2. Deactivate all project webhooks
3. Cancel any queued/building deployments
4. Delete all secrets per environment
5. Delete all environments
6. Delete all project memberships
7. Delete the project document
8. Audit log: `project.deleted`

---

## API Endpoints

```
GET    /api/v1/organizations/:slug/projects           → List active projects
POST   /api/v1/organizations/:slug/projects           → Create project
GET    /api/v1/projects/:projectId                    → Get project detail
PATCH  /api/v1/projects/:projectId                    → Update project
DELETE /api/v1/projects/:projectId                    → Archive project

GET    /api/v1/projects/:projectId/environments       → List environments
POST   /api/v1/projects/:projectId/environments       → Create custom environment
PATCH  /api/v1/projects/:projectId/environments/:id   → Update environment vars/settings
DELETE /api/v1/projects/:projectId/environments/:id   → Delete environment

GET    /api/v1/projects/:projectId/members            → List project members
POST   /api/v1/projects/:projectId/members            → Add member
PATCH  /api/v1/projects/:projectId/members/:userId    → Change member role
DELETE /api/v1/projects/:projectId/members/:userId    → Remove member
```

---

## Decisions

### Project-Level Membership as a Separate Collection
**Decision:** `projectMembers` is a separate collection from `memberships` (org-level).  
**Rationale:** Org membership and project membership have completely separate query patterns. Merging them into one collection with a `scope` discriminator would complicate indexing and every RBAC check. Separate collections with separate compound indexes are cleaner and more performant.

### Default Environment Provisioning
**Decision:** Three environments are auto-created on project creation.  
**Rationale:** Most projects need dev/staging/production. Requiring engineers to manually create these adds friction with zero benefit. Production is auto-protected. Custom environments can be added if the default set is insufficient.

### Embedded Non-Secret Variables
**Decision:** Non-sensitive env vars are embedded in the environment document, not in a separate collection.  
**Rationale:** The query pattern is always "get all env vars for an environment" — an embedded array handles this as a single document read. Separating them into a collection adds a join for the common case with no benefit.

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Org-scoped slug (not global) | Teams can use natural names like `api`, `web` | URL must include org slug for disambiguation |
| Soft delete with BullMQ cascade | Safe, recoverable, no partial deletes | Deleted resources linger until job runs |
| Embedded env vars | Fast reads, atomic updates | Document grows large for projects with many vars (mitigated by 16MB MongoDB document limit) |
| Auto-created environments | Reduced setup friction | Projects that don't need all three carry empty environments |

---

## Future Improvements

- **Project templates** — Pre-configure environments, settings, and default secrets from a template. Useful for organizations that create many similar projects.
- **Project groups / services** — Some architectures have 20+ microservices. A grouping layer above projects (e.g., "Payment Platform" containing `payment-api`, `payment-worker`, `payment-db`) would improve navigation.
- **Environment clone** — Copy all non-secret variables from one environment to another (e.g., clone staging vars to a new `qa` environment).
- **Repository integration** — When `repositoryUrl` is set, integrate with GitHub/GitLab to pull branch lists for `allowedBranches` autocomplete and trigger deployments from push events.
- **Project archiving UI** — The confirmation UX for archiving (similar to GitHub's repo deletion confirmation) needs to be designed carefully to prevent accidental data loss.
