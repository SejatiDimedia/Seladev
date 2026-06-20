# Workspace (Organization) Module

**Document Type:** Feature Module Design  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the Workspace (Organization) module for SELADEV. An organization is the root tenant entity — every resource in the platform (projects, secrets, API keys, deployments, audit logs) is scoped to and owned by an organization. This document covers the organization lifecycle, member management, plan tiers, isolation model, and the design decisions that make multi-tenancy safe and scalable.

---

## Context

SELADEV is a multi-tenant SaaS. Each engineering team or company that adopts SELADEV operates in its own **organization**. The organization is the hard boundary of data isolation — no resource ever crosses organizational boundaries at the data layer.

Requirements this module must satisfy:

- **Tenant isolation** — data belonging to Org A is never visible to Org B, even through misconfigured queries.
- **Multi-org users** — a single user account can be a member of multiple organizations (e.g., a contractor working with two companies).
- **Hierarchical access** — organization-level roles govern what a user can do across all projects within the org.
- **Plan-based limits** — resource ceilings (maxProjects, maxMembers) differ by subscription tier.
- **Auditable admin actions** — member suspension, ownership transfer, and org deletion must be traceable.

---

## Organization Schema

```typescript
// From database-design.md
{
  _id: ObjectId,
  name: string,               // Display name — mutable
  slug: string,               // URL-safe identifier — IMMUTABLE after creation
  plan: 'free' | 'pro' | 'enterprise',
  settings: {
    mfaRequired: boolean,       // Enforce MFA for all members
    allowedDomains: string[],   // SSO/email domain restriction (future)
    maxProjects: number,        // Plan limit
    maxMembers: number,         // Plan limit
  },
  createdBy: ObjectId,        // ref: users
  archivedAt: Date | null,    // Soft delete timestamp
  createdAt: Date,
  updatedAt: Date,
}
```

See [`database-design.md`](database-design.md) for full indexing strategy.

---

## Slug Design

The organization `slug` is the URL-safe, globally unique identifier used in all API routes:

```
GET /api/v1/organizations/acme-corp/projects
```

**Slug rules:**
- Lowercase alphanumeric + hyphens only: `^[a-z0-9-]+$`
- Minimum 3 characters, maximum 48 characters
- Globally unique across all organizations
- **Immutable after creation** — changing a slug would break all bookmarked URLs, API client configurations, and webhook endpoint paths

**Display name vs slug:**
- `name` is the editable display name shown in the UI (e.g., "Acme Corp Engineering")
- `slug` is the stable identifier used in URLs and API paths (e.g., `acme-corp`)
- These are decoupled by design — teams can rebrand without losing URL stability

**Slug generation:**
```typescript
// Auto-generated from name on creation, collision-handled
const slug = await slugService.generate(input.name, 'organizations');
// slugify('Acme Corp') → 'acme-corp'
// if collision: 'acme-corp-1', 'acme-corp-2', etc.
```

---

## Plan Tiers

| Feature | Free | Pro | Enterprise |
|---|---|---|---|
| Max projects | 3 | 20 | Unlimited |
| Max members | 5 | 25 | Unlimited |
| Audit log retention | 30 days | 90 days | 1 year |
| Webhook deliveries retained | 7 days | 30 days | 90 days |
| Protected environments | ✗ | ✓ | ✓ |
| API keys per org | 5 | 50 | Unlimited |
| MFA enforcement | ✗ | ✓ | ✓ |
| SSO/SAML | ✗ | ✗ | ✓ (roadmap) |
| Support | Community | Email | Dedicated |

Plan limits are enforced at the service layer before creation:

```typescript
// organizations.service.ts
async createProject(orgId: string, input: CreateProjectInput) {
  const org = await this.orgRepo.findById(orgId);
  const projectCount = await this.projectRepo.countByOrg(orgId);

  if (projectCount >= org.settings.maxProjects) {
    throw new BusinessRuleViolationError(
      `Plan limit reached: this organization allows a maximum of ${org.settings.maxProjects} projects. Upgrade to create more.`
    );
  }
  // ...
}
```

---

## Organization Lifecycle

### Creation

```
POST /api/v1/organizations
{
  "name": "Acme Corp",
  "slug": "acme-corp"   // optional — auto-generated from name if omitted
}
```

On creation:
1. Slug uniqueness validated (case-insensitive)
2. Organization document created with `plan: 'free'`, default settings
3. Creating user automatically added as `owner` via `memberships` collection
4. Audit log: `org.created`

### Settings Update

Only `owner` and `admin` can update organization settings:

```
PATCH /api/v1/organizations/:orgSlug
{
  "name": "Acme Corp Engineering",
  "settings": {
    "mfaRequired": true
  }
}
```

`slug` is excluded from the updatable fields at the Zod schema level — any attempt to update it returns a 400 validation error.

### Soft Deletion (Archiving)

Organizations are **never hard-deleted** in the MVP. Archiving sets `archivedAt` and:
- Prevents login to the org context
- Hides all org resources from API responses
- Retains all data for potential recovery within 30 days
- After 30 days, a scheduled BullMQ job permanently deletes the org and all cascading resources

Only `owner` can archive an organization. A confirmation phrase must be typed in the UI (e.g., `delete acme-corp`) before the API call is made.

---

## Member Management

### Membership Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  userId: ObjectId,
  role: 'owner' | 'admin' | 'member' | 'viewer',
  invitedBy: ObjectId,
  status: 'active' | 'invited' | 'suspended',
  joinedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}
```

### Invite Flow

```
1. Admin sends invite: POST /api/v1/organizations/:slug/members
   { "email": "newuser@example.com", "role": "member" }

2. If user exists:
   → Membership created with status: 'invited'
   → In-app notification sent to user
   → Email sent with accept link

3. If user does not exist:
   → Pending invite stored (email-keyed)
   → Email sent with registration + accept link

4. User accepts: POST /api/v1/organizations/:slug/members/accept
   → Membership status updated to 'active'
   → joinedAt set to now
   → Audit log: member.joined
```

Pending invites expire after 7 days (TTL enforced by BullMQ cleanup job).

### Member Suspension

Admin or owner can suspend a member:

```
PATCH /api/v1/organizations/:slug/members/:userId
{ "status": "suspended" }
```

On suspension:
- `membership.status` → `'suspended'`
- All active refresh tokens for this user in this org context are revoked (Redis blocklist)
- RBAC cache for `userId:orgId` is invalidated
- Audit log: `member.suspended`

A suspended member cannot authenticate into the org but their account and data remain intact.

### Admin Actions

| Action | Required Role | Endpoint |
|---|---|---|
| Invite member | admin, owner | `POST /members` |
| Remove member | admin, owner | `DELETE /members/:userId` |
| Change member role | admin, owner | `PATCH /members/:userId` |
| Suspend member | admin, owner | `PATCH /members/:userId { status: 'suspended' }` |
| Force logout member | owner | `POST /members/:userId/force-logout` |
| Transfer ownership | owner | `POST /transfer-ownership` |

### Ownership Transfer

```
POST /api/v1/organizations/:slug/transfer-ownership
{ "newOwnerId": "userId123" }
```

Transfer rules:
1. Only current `owner` can initiate
2. Target user must be an active `admin` or `member`
3. Current owner's role is downgraded to `admin` atomically
4. Target user's role is upgraded to `owner` atomically
5. Both operations run in a MongoDB session (atomic)
6. Audit log: `org.ownership_transferred`

### Last Admin Constraint

The system prevents removing or demoting the last active `admin` or `owner`. If only one admin remains:

```typescript
// Service layer guard
const activeAdmins = await memberRepo.countByOrgAndRole(orgId, ['owner', 'admin']);
if (activeAdmins <= 1 && isDowngrade(currentRole, newRole)) {
  throw new BusinessRuleViolationError(
    'Cannot remove the last administrator. Assign another admin first.'
  );
}
```

---

## Multi-Org User Experience

A user can be a member of multiple organizations. The active organization context is:
1. Stored in the JWT payload (`orgId` claim)
2. Tracked in Zustand client store (`org.store.ts`)

**Org switcher flow:**
```
User opens org switcher dropdown
  → Frontend fetches GET /api/v1/me/organizations (list of user's orgs)
  → User selects target org
  → POST /auth/switch-org { orgId }
  → Server issues new access token with updated orgId claim
  → Frontend updates Zustand store + invalidates all TanStack Query caches
  → UI re-renders with new org context
```

The `X-Org-Id` request header can override the active org from the JWT for users in multiple orgs without requiring a full token refresh.

---

## Tenant Isolation Architecture

Data isolation is enforced at **three independent layers**:

### Layer 1: JWT Payload
Every request carries `orgId` in the JWT. The authenticateJWT middleware attaches `req.user.orgId` — this is the authoritative org context for the request.

### Layer 2: RBAC Middleware
`authorizeRBAC` verifies that `req.user.userId` is an active member of `req.user.orgId`. This prevents token forgery from granting access to other orgs.

### Layer 3: Repository Base Class
Every repository extends `BaseRepository`, which automatically appends `{ organizationId: req.user.orgId }` to every query:

```typescript
// infrastructure/database/base.repository.ts
abstract class BaseRepository<T> {
  async findAll(filter: Partial<T>, orgId: string): Promise<T[]> {
    return this.model.find({ ...filter, organizationId: orgId });
  }

  async findById(id: string, orgId: string): Promise<T | null> {
    return this.model.findOne({ _id: id, organizationId: orgId });
  }
}
```

`organizationId` is never an optional parameter — methods that don't accept it simply don't exist. This makes accidental cross-org data access structurally impossible at the repository layer.

---

## API Endpoints

```
GET    /api/v1/organizations                    → List orgs for current user
POST   /api/v1/organizations                    → Create organization
GET    /api/v1/organizations/:slug              → Get organization
PATCH  /api/v1/organizations/:slug              → Update name/settings
DELETE /api/v1/organizations/:slug              → Archive organization

GET    /api/v1/organizations/:slug/members      → List members (paginated)
POST   /api/v1/organizations/:slug/members      → Invite member
PATCH  /api/v1/organizations/:slug/members/:id  → Update member role/status
DELETE /api/v1/organizations/:slug/members/:id  → Remove member

POST   /api/v1/organizations/:slug/transfer-ownership
POST   /api/v1/organizations/:slug/members/:id/force-logout

GET    /api/v1/me/organizations                 → All orgs for authenticated user
```

---

## Org-Level Audit Trail

All mutating organization operations are recorded to `auditLogs`:

| Event | Trigger |
|---|---|
| `org.created` | Organization created |
| `org.updated` | Settings or name changed |
| `org.archived` | Organization soft-deleted |
| `member.invited` | Invitation sent |
| `member.joined` | Invitation accepted |
| `member.removed` | Member removed |
| `member.role_changed` | Role updated |
| `member.suspended` | Member suspended |
| `member.force_logged_out` | Admin force-logout |
| `org.ownership_transferred` | Ownership changed |

See [`audit-logs.md`](audit-logs.md) for the full audit log schema.

---

## Decisions

### Slug Immutability
**Decision:** `slug` is immutable after creation.  
**Rationale:** Slugs appear in API URLs, webhook endpoint configs, and bookmarks. A slug change is a breaking change for every integration built on top. The `name` field provides an editable display label without destabilizing URLs.

### Soft Delete over Hard Delete
**Decision:** Organizations are archived, not immediately destroyed.  
**Rationale:** Accidental deletion is unrecoverable. A 30-day grace period allows recovery. This matches industry practice (GitHub, Vercel, Netlify all have grace periods). Hard deletion runs as a scheduled background job after the period expires.

### Shared Database Multi-Tenancy
**Decision:** All organizations share the same MongoDB collections, isolated by `organizationId` filter.  
**Rationale:** Database-per-tenant is operationally expensive (connection pools, migrations, monitoring per tenant). At the current scale, mandatory `organizationId` filtering provides sufficient isolation. See [`adr.md` ADR-005](adr.md) for the full decision record.

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Slug immutability | URL stability, no broken integrations | Users cannot rename their org URL |
| Shared DB tenancy | Simple ops, lower cost, easy cross-org analytics | Must be disciplined about `organizationId` in every query |
| Soft delete | Recovery possible, audit-friendly | Storage grows until hard-delete job runs |
| Plan limits in service layer | Easy to change limits per plan | Could be bypassed by calling repository directly (mitigated by architecture lint) |

---

## Future Improvements

- **SSO/SAML** — `allowedDomains` in org settings is reserved for future SSO enforcement. When a user with a matching email domain joins, they are automatically routed through the org's SAML identity provider.
- **Organization billing integration** — `plan` is currently a static enum. A billing service (Stripe) would manage plan upgrades and update `org.plan` via webhook.
- **Sub-organizations / Teams** — Some enterprises need nested org structures. A `parentOrgId` field on the org document and a team-level membership model would enable this without restructuring the base tenancy model.
- **Org-level API keys** — Keys scoped to the entire organization (not a specific project) already exist in the schema. Rate limits and scope definitions for org-level keys need formalization.
- **Data export** — GDPR compliance requires the ability to export all data belonging to an organization. A BullMQ job that streams all collections filtered by `organizationId` to a ZIP archive is the planned approach.
