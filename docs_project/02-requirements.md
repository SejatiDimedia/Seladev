# SELADEV — Requirements Document

> **Document type:** Software Requirements Specification (SRS)
> **Status:** Approved — v1.0
> **Audience:** Senior Engineers, Architects, QA Lead, Security Reviewer

---

## Table of Contents

1. [Functional Requirements](#1-functional-requirements)
   - 1.1 Authentication & Authorization
   - 1.2 Organizations
   - 1.3 Projects
   - 1.4 Environments
   - 1.5 Secrets & Config
   - 1.6 API Keys
   - 1.7 Deployments
   - 1.8 Webhooks
   - 1.9 Audit Logs
   - 1.10 Notifications
   - 1.11 Analytics
2. [Non-Functional Requirements](#2-non-functional-requirements)
   - 2.1 Performance
   - 2.2 Security
   - 2.3 Scalability
   - 2.4 Availability & Reliability
   - 2.5 Maintainability
3. [Constraints](#3-constraints)
4. [Assumptions](#4-assumptions)
5. [External Dependencies](#5-external-dependencies)
6. [API Contracts Reference](#6-api-contracts-reference)
7. [Data Retention Requirements](#7-data-retention-requirements)
8. [Compliance Requirements](#8-compliance-requirements)

---

## 1. Functional Requirements

> **Notation:** Requirements are identified as `FR-<MODULE>-<NUMBER>`. Each requirement states a verifiable, atomic capability the system must provide.

---

### 1.1 Authentication & Authorization

#### FR-AUTH-01 — User Registration
The system MUST accept user registration via `POST /api/v1/auth/register` with fields `name` (string, 2–100 chars), `email` (valid RFC 5322 format), and `password` (min 8 chars). Duplicate email registration MUST return `409 Conflict`.

#### FR-AUTH-02 — Password Hashing
All passwords MUST be hashed using bcrypt with a minimum cost factor of 12 before persistence. Plaintext passwords MUST NOT be written to any log, database, or queue payload at any point in the request lifecycle.

#### FR-AUTH-03 — JWT Issuance (RS256)
Upon successful authentication, the system MUST issue a JSON Web Token signed with RS256 (asymmetric RSA-SHA256). The private key MUST be stored as an environment variable (`JWT_PRIVATE_KEY`); the public key (`JWT_PUBLIC_KEY`) MUST be used for verification. HS256 symmetric signing MUST NOT be used.

#### FR-AUTH-04 — Access Token Lifetime
Access tokens MUST have a maximum expiry of 15 minutes (`exp` claim). The `iss` (issuer) claim MUST be set to `seladev`. The `sub` claim MUST be the user's MongoDB ObjectId string.

#### FR-AUTH-05 — Refresh Token Rotation
Refresh tokens MUST be stored in an `HttpOnly; Secure; SameSite=Strict` cookie. Each use of a refresh token MUST issue a new refresh token and invalidate the used one (rotation). Replay of an already-used refresh token MUST invalidate the entire token family and return `401 Unauthorized`.

#### FR-AUTH-06 — Refresh Token Expiry
Refresh tokens MUST expire after 7 days of inactivity. Expired tokens MUST return `401 Unauthorized` with error code `REFRESH_TOKEN_EXPIRED`.

#### FR-AUTH-07 — Logout
`POST /api/v1/auth/logout` MUST invalidate the current refresh token in the database and clear the cookie. The endpoint MUST return `204 No Content`.

#### FR-AUTH-08 — Rate Limiting on Login
The login endpoint MUST enforce rate limiting: maximum 5 failed attempts per IP address per 15-minute window. Exceeding this threshold MUST return `429 Too Many Requests` with a `Retry-After` header.

#### FR-AUTH-09 — RBAC Enforcement
Every API endpoint that operates on org or project resources MUST enforce RBAC. The middleware layer MUST verify both:
1. The user's org-level role against the org resource being accessed
2. The user's project-level role against the project resource being accessed

Role hierarchy (descending permission): `super_admin > org_admin > project_admin > developer > viewer`

#### FR-AUTH-10 — Password Change
`PUT /api/v1/auth/password` MUST require the current password for verification. Successful password change MUST invalidate all active refresh tokens for the user. New password MUST satisfy the policy: minimum 8 characters, at least 1 uppercase letter, 1 digit, 1 special character.

---

### 1.2 Organizations

#### FR-ORG-01 — Organization Creation
`POST /api/v1/organizations` MUST accept `{ name, slug }`. The `slug` field MUST be globally unique, URL-safe (lowercase alphanumeric and hyphens), and between 3–50 characters. The creating user MUST be automatically assigned the `org_admin` role.

#### FR-ORG-02 — Organization Retrieval
`GET /api/v1/organizations/:orgId` MUST return the organization object with member count. Only authenticated users who are members of the organization MAY access this endpoint.

#### FR-ORG-03 — Member Invitation
`POST /api/v1/organizations/:orgId/members` MUST accept `{ email, role }` where role is `org_admin` or `member`. Only users with `org_admin` role MAY call this endpoint. If the email does not match an existing user, an invitation email MUST be queued.

#### FR-ORG-04 — Member Removal
`DELETE /api/v1/organizations/:orgId/members/:userId` MUST remove all org-level and project-level role assignments for the user within the org atomically. The system MUST prevent removal of the sole `org_admin` and return `422 Unprocessable Entity`.

#### FR-ORG-05 — Member Role Update
`PUT /api/v1/organizations/:orgId/members/:userId` MUST allow updating the org-level role. Role changes MUST be audit-logged.

---

### 1.3 Projects

#### FR-PROJ-01 — Project Creation
`POST /api/v1/organizations/:orgId/projects` MUST accept `{ name, slug, description? }`. The slug MUST be unique within the organization. Three default environments MUST be created automatically: `development`, `staging`, `production`. The creating user MUST be assigned `project_admin`.

#### FR-PROJ-02 — Project Listing
`GET /api/v1/organizations/:orgId/projects` MUST return only projects where the authenticated user has at least one role assignment. `org_admin` and `super_admin` MUST see all projects in the org.

#### FR-PROJ-03 — Project Update
`PUT /api/v1/projects/:projectId` MUST allow updating `name`, `description`, and `status` (active/archived). Only `project_admin` and above MAY update. Archiving a project MUST NOT delete its data.

#### FR-PROJ-04 — Project Member Management
`PUT /api/v1/projects/:projectId/members/:userId` MUST accept `{ role }` from `[project_admin, developer, viewer]`. The user MUST already be an org member; assigning a non-member MUST return `422`. Role assignment and changes MUST be audit-logged with old and new role in metadata.

#### FR-PROJ-05 — Project Deletion
`DELETE /api/v1/projects/:projectId` MUST require `org_admin` or `super_admin` role. Deletion MUST be soft (set `deletedAt`); hard deletion is not supported in v1.0. Active deployments or webhooks on the project MUST block deletion with `409 Conflict`.

---

### 1.4 Environments

#### FR-ENV-01 — Environment Creation
`POST /api/v1/projects/:projectId/environments` MUST accept `{ name, slug }`. Slug MUST be unique within the project. Environment creation MUST be audit-logged.

#### FR-ENV-02 — Environment Update
`PUT /api/v1/projects/:projectId/environments/:envId` MUST allow renaming. Slug changes MUST validate uniqueness within the project. Slug is immutable once set (only name can change) to preserve URL references.

#### FR-ENV-03 — Environment Deletion
`DELETE /api/v1/projects/:projectId/environments/:envId` MUST require an explicit confirmation string in the request body (`{ confirm: "delete" }`). All secrets scoped to the environment MUST be deleted as part of the same atomic operation. Environments with active deployments MUST return `409 Conflict`.

#### FR-ENV-04 — Default Environment Protection
The three default environments (`development`, `staging`, `production`) MUST be prevented from deletion unless explicitly overridden by `org_admin`. The system MUST enforce this constraint.

---

### 1.5 Secrets & Config

#### FR-SEC-01 — Secret Encryption
All secret values MUST be encrypted at rest using AES-256-GCM with a unique 12-byte initialization vector (IV) per secret value. The encryption key MUST be stored as an environment variable (`SECRET_ENCRYPTION_KEY`) and MUST be 32 bytes (256-bit). The IV MUST be stored alongside the ciphertext in the database as a hex string.

#### FR-SEC-02 — Secret Key Naming
Secret keys MUST match the pattern `/^[A-Z][A-Z0-9_]*$/` (uppercase letters, digits, underscores; must start with a letter). Violation MUST return `422 Unprocessable Entity` with error code `INVALID_SECRET_KEY_FORMAT`.

#### FR-SEC-03 — Secret Key Uniqueness
Secret keys MUST be unique within a given `(projectId, environmentId)` scope. Attempting to create a duplicate MUST return `409 Conflict`.

#### FR-SEC-04 — Masked Secret Response
`GET /api/v1/projects/:projectId/environments/:envId/secrets` MUST return `value: "****"` for all roles. The plaintext value MUST NEVER appear in list responses.

#### FR-SEC-05 — Secret Reveal Endpoint
`GET /api/v1/projects/:projectId/environments/:envId/secrets/:secretId/reveal` MUST decrypt and return the plaintext value. Only `project_admin`, `org_admin`, and `super_admin` MAY call this endpoint. Every reveal call MUST be written to the audit log synchronously with actor details. The endpoint MUST be rate-limited: max 30 reveals per user per 10 minutes.

#### FR-SEC-06 — Secret Update
`PUT /api/v1/projects/:projectId/environments/:envId/secrets/:secretId` MUST re-encrypt the new value with a freshly generated IV. The previous ciphertext MUST be overwritten. The audit log entry MUST include `{ value_changed: true }` but MUST NOT include the plaintext value.

#### FR-SEC-07 — Secret Soft Delete
`DELETE /api/v1/projects/:projectId/environments/:envId/secrets/:secretId` MUST set `deletedAt` on the record rather than performing a hard delete. Deleted secrets MUST NOT appear in list responses. The deletion MUST be audit-logged.

#### FR-SEC-08 — Secret Expiry
Secrets MAY include an optional `expiresAt` timestamp. Secrets where `expiresAt < now` MUST be visually flagged as expired in list responses with `isExpired: true`. Expiring secrets (within 7 days) MUST trigger a notification to all project admins.

---

### 1.6 API Keys

#### FR-KEY-01 — Key Issuance
`POST /api/v1/projects/:projectId/api-keys` MUST generate a cryptographically random key value using `crypto.randomBytes(32)` encoded as a URL-safe base64 string, prefixed with `sk_`. The full raw value MUST be returned only once in the issuance response. The system MUST store only the SHA-256 hash of the raw value; the raw value MUST NOT be stored.

#### FR-KEY-02 — Key Preview
The stored record MUST include a `keyPreview` field containing the last 4 characters of the raw key, prefixed with `sk_...`. This preview MUST be returned in all subsequent list and detail responses.

#### FR-KEY-03 — Key Scopes
API keys MUST carry a `scopes` array. Valid scopes:
- `deployments:read` — Can read deployment status and history
- `deployments:write` — Can trigger and cancel deployments
- `secrets:read` — Can read masked secret keys (NOT reveal plaintext)
- `webhooks:read` — Can read webhook configuration
- `webhooks:write` — Can create and update webhooks

The RBAC middleware MUST validate both the user/API key role AND the key's scope array when a request is authenticated via API key.

#### FR-KEY-04 — Key Expiry
API keys MUST honor the optional `expiresAt` field. Requests authenticated with an expired key MUST return `401 Unauthorized` with error code `API_KEY_EXPIRED`. Keys expiring within 7 days MUST trigger a notification.

#### FR-KEY-05 — Key Rotation
`POST /api/v1/projects/:projectId/api-keys/:keyId/rotate` MUST atomically:
1. Generate a new raw key value
2. Store the new SHA-256 hash
3. Set `revokedAt` on the old key record
4. Return the new raw key value

The new key inherits `name`, `scopes`, and `expiresAt` from the rotated key. Both actions MUST be written to the audit log as a single `api_key.rotated` event with old and new key IDs in metadata.

#### FR-KEY-06 — Key Revocation
`DELETE /api/v1/projects/:projectId/api-keys/:keyId` MUST set `revokedAt` immediately. Subsequent authentication attempts with the revoked key MUST return `401 Unauthorized` with error code `API_KEY_REVOKED`. Revocation MUST be audit-logged.

#### FR-KEY-07 — Key Last Used Tracking
The system MUST update `lastUsedAt` on the API key record on every successful authentication. This update SHOULD be non-blocking (fire-and-forget or background update).

---

### 1.7 Deployments

#### FR-DEP-01 — Deployment Trigger
`POST /api/v1/projects/:projectId/environments/:envId/deployments` MUST enqueue a BullMQ job and return `201 Created` with `{ id, status: "QUEUED" }` within 500ms regardless of queue depth.

#### FR-DEP-02 — Deployment Status Machine
The deployment job worker MUST transition the deployment through the following states in order:
```
QUEUED → BUILDING → DEPLOYING → SUCCESS
                              → FAILED
QUEUED → CANCELLED (if cancelled before DEPLOYING)
BUILDING → CANCELLED (if cancelled before DEPLOYING)
```
Each transition MUST:
1. Update the `status` and `[phase]At` timestamp fields on the Deployment document
2. Emit a Socket.IO event `deployment:status_changed` to room `deployment:{deploymentId}`
3. Emit a Socket.IO event to the project room `project:{projectId}` for project-wide listeners

#### FR-DEP-03 — Real-Time Status Push
The server MUST use `socket.io` with a Redis adapter (`@socket.io/redis-adapter`) to ensure events are delivered across multiple Node.js processes. Clients MUST join the room `deployment:{deploymentId}` to receive status updates.

#### FR-DEP-04 — Deployment History
`GET /api/v1/projects/:projectId/environments/:envId/deployments` MUST return cursor-based paginated results with a maximum of 50 per page. Results MUST be ordered by `createdAt` descending. Supports filtering by `status`.

#### FR-DEP-05 — Deployment Cancellation
`POST /api/v1/projects/:projectId/environments/:envId/deployments/:deploymentId/cancel` MUST only succeed if the current status is `QUEUED` or `BUILDING`. Attempting to cancel a `DEPLOYING`, `SUCCESS`, or `FAILED` deployment MUST return `422 Unprocessable Entity`.

#### FR-DEP-06 — Deployment Actor Attribution
Every deployment record MUST store the `triggeredBy` field referencing the user ID (or API key ID) that triggered it.

#### FR-DEP-07 — Post-Deploy Events
On deployment terminal state (`SUCCESS` or `FAILED`), the system MUST:
1. Write an audit log entry
2. Enqueue a notification job for all project members with `developer` role or above
3. Trigger any registered webhooks for `deployment.succeeded` or `deployment.failed` events

---

### 1.8 Webhooks

#### FR-WH-01 — Webhook Registration
`POST /api/v1/projects/:projectId/webhooks` MUST accept `{ url, events, secret?, description? }`. The `url` MUST pass URL validation (valid HTTPS URL). The `secret` field, if omitted, MUST be auto-generated as `crypto.randomBytes(32).toString('hex')` and returned once in the response.

#### FR-WH-02 — Supported Event Types
The system MUST support the following webhook event types:
- `deployment.queued`, `deployment.succeeded`, `deployment.failed`, `deployment.cancelled`
- `secret.created`, `secret.updated`, `secret.deleted`
- `api_key.rotated`, `api_key.revoked`
- `member.added`, `member.removed`, `member.role_changed`

#### FR-WH-03 — Payload Signing
Every webhook delivery MUST include an `X-SELADEV-Signature` header with value `sha256=<hmac>` where `<hmac>` is computed as `HMAC-SHA256(signingSecret, rawBodyString)`. The body MUST be the raw JSON-serialized payload string used for signing. Recipients MUST be able to verify the signature by recomputing the HMAC.

#### FR-WH-04 — Standard Payload Shape
All webhook payloads MUST conform to:
```typescript
interface WebhookPayload {
  id: string;           // Unique delivery ID
  event: string;        // e.g. "deployment.succeeded"
  timestamp: string;    // ISO 8601 UTC
  organizationId: string;
  projectId: string;
  data: Record<string, unknown>; // Event-specific data
}
```

#### FR-WH-05 — Delivery Retry Policy
Failed webhook deliveries (non-2xx HTTP response or connection timeout > 10s) MUST be retried with exponential backoff:
- Attempt 2: delay 30 seconds
- Attempt 3: delay 2 minutes
- Attempt 4: delay 10 minutes
- Attempt 5: delay 1 hour
After 5 total attempts, the delivery MUST be moved to the dead letter queue. No further automatic retries occur.

#### FR-WH-06 — Dead Letter Queue
The system MUST maintain a dead letter queue (DLQ) for exhausted webhook deliveries. `GET /api/v1/projects/:projectId/webhooks/:webhookId/dead-letters` MUST return DLQ entries. `POST /api/v1/projects/:projectId/webhooks/:webhookId/dead-letters/:dlqId/replay` MUST re-enqueue the delivery as a fresh BullMQ job.

#### FR-WH-07 — Delivery Log
Each delivery attempt MUST be recorded with: `attemptNumber`, `responseStatusCode`, `responseBody` (first 500 chars), `requestedAt`, `respondedAt`, `success`. This log MUST be accessible via `GET /api/v1/projects/:projectId/webhooks/:webhookId/deliveries`.

---

### 1.9 Audit Logs

#### FR-AUD-01 — Audit Log Schema
Every audit log entry MUST capture the following fields:

```typescript
interface AuditLogEntry {
  id: string;
  organizationId: string;
  projectId?: string;           // Null for org-level actions
  actor: {
    userId: string;
    email: string;
    role: string;
    apiKeyId?: string;          // If authenticated via API key
  };
  action: string;               // e.g. "secret.created", "deployment.triggered"
  resource: {
    type: string;               // e.g. "secret", "deployment", "api_key"
    id: string;
  };
  metadata: Record<string, unknown>; // Action-specific context
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
}
```

#### FR-AUD-02 — Mandatory Audit Actions
The following actions MUST generate an audit log entry, written synchronously before the API response is sent:

| Action | trigger |
|---|---|
| `auth.login` | Successful login |
| `auth.logout` | Logout |
| `auth.password_changed` | Password change |
| `org.created` | Org creation |
| `org.member_added` | Member invite accepted |
| `org.member_removed` | Member removal |
| `org.member_role_changed` | Role update |
| `project.created` | Project creation |
| `project.archived` | Project archival |
| `project.member_role_assigned` | Project role assignment |
| `environment.created` | Environment creation |
| `environment.deleted` | Environment deletion |
| `secret.created` | Secret created |
| `secret.updated` | Secret updated |
| `secret.deleted` | Secret deleted |
| `secret.revealed` | Secret value revealed |
| `api_key.issued` | API key issued |
| `api_key.rotated` | API key rotated |
| `api_key.revoked` | API key revoked |
| `deployment.triggered` | Deployment job enqueued |
| `deployment.cancelled` | Deployment cancelled |
| `deployment.succeeded` | Deployment terminal success |
| `deployment.failed` | Deployment terminal failure |
| `webhook.created` | Webhook registered |
| `webhook.updated` | Webhook updated |
| `webhook.deleted` | Webhook deleted |

#### FR-AUD-03 — Immutability Enforcement
The `AuditLog` MongoDB collection MUST have NO update or delete operations defined in its Mongoose model or repository layer. The repository MUST expose only `create(entry)` and `findMany(filter)` methods. Any attempt to call update or delete at the repository interface MUST fail at compile time (TypeScript type error).

#### FR-AUD-04 — Audit Log Querying
`GET /api/v1/organizations/:orgId/audit-logs` and `GET /api/v1/projects/:projectId/audit-logs` MUST support:
- Filter by `action` (exact or prefix match, e.g., `secret.*`)
- Filter by `resourceType`
- Filter by `actorId`
- Filter by `from` and `to` (ISO 8601 date range on `createdAt`)
- Cursor-based pagination with `limit` (max 100, default 25)
- Response ordered by `createdAt` descending

#### FR-AUD-05 — Audit Log Access Control
Only `org_admin` and `super_admin` MAY access org-level audit logs. `project_admin` MAY access project-scoped audit logs. `developer` and `viewer` MUST receive `403 Forbidden`.

---

### 1.10 Notifications

#### FR-NOT-01 — Real-Time Delivery
Notifications MUST be pushed to authenticated clients via Socket.IO. Each user MUST automatically join the room `user:{userId}` upon socket authentication. Notification events MUST be emitted to this room.

#### FR-NOT-02 — Notification Document Schema
```typescript
interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
}

type NotificationType =
  | 'deployment.succeeded'
  | 'deployment.failed'
  | 'secret.expiring'
  | 'api_key.expiring'
  | 'webhook.delivery_failed'
  | 'role.changed'
  | 'member.added';
```

#### FR-NOT-03 — Notification Triggers
The following events MUST trigger notification creation:
- **Deployment succeeded/failed:** Notify all project members with `developer` role and above
- **Secret expiring:** Notify `project_admin` and above, 7 days before `expiresAt`
- **API key expiring:** Notify `project_admin` and above, 7 days before `expiresAt`
- **Webhook delivery failed (all retries exhausted):** Notify `project_admin` and above
- **Role changed:** Notify the affected user
- **Member added to project:** Notify the added user

#### FR-NOT-04 — Email Notification Queue
Email notifications MUST be enqueued in a BullMQ queue (`email-notifications`) and processed by a dedicated worker. Email delivery failure MUST NOT block or roll back the primary triggering operation.

#### FR-NOT-05 — Mark as Read
`PUT /api/v1/notifications/:notificationId/read` and `PUT /api/v1/notifications/read-all` MUST update the `read` flag and set `readAt`. The unread count update MUST be pushed to the client via Socket.IO.

#### FR-NOT-06 — Notification Preferences
`GET /api/v1/users/me/notification-preferences` and `PUT /api/v1/users/me/notification-preferences` MUST manage per-category preferences `{ inApp: boolean, email: boolean }`. Security-critical notifications (`role.changed`, `member.removed`) MUST NOT be suppressible.

---

### 1.11 Analytics

#### FR-ANA-01 — Deployment Frequency
`GET /api/v1/projects/:projectId/analytics/deployments` MUST return time-series data aggregated by day, week, or month (controlled by `granularity` query parameter). Data MUST include: `total`, `succeeded`, `failed`, `cancelled` counts per period.

#### FR-ANA-02 — Deployment Success Rate
The analytics endpoint MUST include a `successRate` field (percentage) computed as `succeeded / (succeeded + failed)` for the requested time range.

#### FR-ANA-03 — API Key Usage
`GET /api/v1/projects/:projectId/analytics/api-keys` MUST return per-key usage counts derived from `lastUsedAt` update events, grouped by day.

#### FR-ANA-04 — Secret Access Frequency
`GET /api/v1/projects/:projectId/analytics/secrets` MUST return reveal counts per secret key derived from audit log entries with `action = "secret.revealed"`.

#### FR-ANA-05 — Webhook Delivery Rate
`GET /api/v1/projects/:projectId/analytics/webhooks` MUST return total deliveries, successful deliveries, and delivery success rate per webhook per time period.

#### FR-ANA-06 — Analytics Access Control
Only `org_admin`, `project_admin`, and `super_admin` MAY access analytics endpoints. `developer` and `viewer` MUST receive `403 Forbidden`.

---

## 2. Non-Functional Requirements

### 2.1 Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-01 | API response time (p99) for read endpoints | < 200ms |
| NFR-PERF-02 | API response time (p99) for write endpoints | < 500ms |
| NFR-PERF-03 | Deployment job enqueue latency | < 500ms from request to `QUEUED` |
| NFR-PERF-04 | Real-time notification delivery latency | < 500ms from server event to client UI |
| NFR-PERF-05 | Webhook delivery initiation latency | < 10s from triggering event |
| NFR-PERF-06 | Secret encryption/decryption overhead | < 5ms per operation (AES-256-GCM is sub-millisecond; overhead is DB I/O) |
| NFR-PERF-07 | MongoDB query performance | All frequently-queried fields MUST have appropriate indexes |
| NFR-PERF-08 | BullMQ job throughput | ≥ 50 concurrent deployment jobs without queue saturation |

**Index requirements (MongoDB):**

| Collection | Index Fields |
|---|---|
| `users` | `email` (unique) |
| `organizations` | `slug` (unique) |
| `projects` | `(organizationId, slug)` (unique compound) |
| `secrets` | `(projectId, environmentId, key)` (unique compound), `expiresAt` |
| `api_keys` | `hash` (unique), `(projectId, revokedAt)` |
| `deployments` | `(projectId, environmentId, createdAt)` |
| `audit_logs` | `(organizationId, createdAt)`, `(projectId, createdAt)`, `actorId` |
| `notifications` | `(userId, read, createdAt)` |

### 2.2 Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | All API traffic MUST be served over HTTPS (TLS 1.2 minimum) in production |
| NFR-SEC-02 | JWT signing MUST use RS256 (RSA-SHA256); HS256 is prohibited |
| NFR-SEC-03 | Secret values MUST be encrypted with AES-256-GCM; no plaintext persistence |
| NFR-SEC-04 | API key raw values MUST be hashed with SHA-256; raw values are never stored |
| NFR-SEC-05 | Webhook payloads MUST be signed with HMAC-SHA256 |
| NFR-SEC-06 | All sensitive environment variables MUST be injected via environment; no hardcoded secrets |
| NFR-SEC-07 | bcrypt cost factor for passwords MUST be ≥ 12 |
| NFR-SEC-08 | HTTP response headers MUST include: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` (production), `Content-Security-Policy` |
| NFR-SEC-09 | All API inputs MUST be validated with Zod schemas before processing |
| NFR-SEC-10 | CORS MUST be configured to allow only the explicit frontend origin (`CORS_ORIGIN` env var) |
| NFR-SEC-11 | MongoDB queries MUST use parameterized Mongoose queries; no string interpolation in queries |
| NFR-SEC-12 | The platform MUST address OWASP Top 10 (2021) categories A01–A10 as documented in `security.md` |
| NFR-SEC-13 | Refresh tokens MUST be stored hashed (SHA-256) in the database; plaintext refresh token is never persisted |
| NFR-SEC-14 | Audit log writes MUST be synchronous and MUST precede the API response; they MUST NOT be async fire-and-forget |

### 2.3 Scalability

| ID | Requirement | Target |
|---|---|---|
| NFR-SCALE-01 | Concurrent authenticated users (v1.0) | ≥ 500 |
| NFR-SCALE-02 | Active Socket.IO connections | ≥ 1,000 (enforced via Redis adapter) |
| NFR-SCALE-03 | BullMQ job workers | Horizontally scalable; worker count configurable via `WORKER_CONCURRENCY` env var |
| NFR-SCALE-04 | MongoDB connection pool | Configurable via `MONGO_POOL_SIZE` (default: 10) |
| NFR-SCALE-05 | API server horizontal scaling | Stateless API server; state held in MongoDB + Redis; multiple instances supported |
| NFR-SCALE-06 | Deployment history per environment | No hard limit; cursor pagination prevents N+1 on large datasets |

### 2.4 Availability & Reliability

| ID | Requirement |
|---|---|
| NFR-AVAIL-01 | Target uptime SLA: **99.5%** (measured monthly, excluding planned maintenance) |
| NFR-AVAIL-02 | Planned maintenance windows MUST be communicated ≥ 24 hours in advance |
| NFR-AVAIL-03 | The API server MUST implement graceful shutdown (drain in-flight requests before exit) |
| NFR-AVAIL-04 | BullMQ jobs MUST be persisted in Redis; a worker restart MUST NOT lose enqueued jobs |
| NFR-AVAIL-05 | Redis connection loss MUST NOT crash the API server; it MUST degrade gracefully (queue operations fail with a 503, non-queue operations continue) |
| NFR-AVAIL-06 | MongoDB connection loss MUST trigger automatic reconnection with exponential backoff |
| NFR-AVAIL-07 | Health check endpoint `GET /api/v1/health` MUST return `{ status: "ok" | "degraded", mongo: string, redis: string }` |
| NFR-AVAIL-08 | Email delivery failure MUST NOT affect primary API operations (fully async, isolated failure domain) |

### 2.5 Maintainability

| ID | Requirement |
|---|---|
| NFR-MAINT-01 | All source code MUST pass TypeScript compilation with `"strict": true` with zero errors |
| NFR-MAINT-02 | Backend service layer line coverage MUST be ≥ 80% (enforced in CI via Vitest coverage) |
| NFR-MAINT-03 | All public API endpoints MUST be documented in the OpenAPI 3.0 specification |
| NFR-MAINT-04 | Feature code MUST follow the feature-based folder structure as defined in `folder-structure.md` |
| NFR-MAINT-05 | Repository layer MUST be the only layer that interacts with Mongoose models |
| NFR-MAINT-06 | All environment variables MUST be documented in `.env.example` and validated at startup |
| NFR-MAINT-07 | No `TODO` or `FIXME` comments MUST exist in the main branch service layer code |
| NFR-MAINT-08 | All Git commits to `main` MUST pass the CI pipeline (type-check, lint, unit test, integration test) |
| NFR-MAINT-09 | Error responses MUST follow the standardized error envelope: `{ success: false, error: { code, message, details? } }` |

---

## 3. Constraints

### 3.1 Technology Stack (Locked)

The following technology choices are fixed for v1.0 and MUST NOT be substituted:

| Layer | Technology | Version |
|---|---|---|
| Frontend runtime | React 18 + TypeScript + Vite | React ≥ 18.2 |
| Frontend state | TanStack Query v5 + Zustand v4 | As specified |
| Frontend UI | shadcn/ui + TailwindCSS | As specified |
| Frontend forms | React Hook Form + Zod | As specified |
| Backend runtime | Node.js + Express.js + TypeScript | Node ≥ 20 LTS |
| Database | MongoDB + Mongoose | MongoDB ≥ 7.0 |
| Cache / Queue backend | Redis | Redis ≥ 7.0 |
| Job queue | BullMQ | ≥ 5.x |
| Real-time | Socket.IO + @socket.io/redis-adapter | ≥ 4.x |
| Monorepo | pnpm workspaces + Turborepo | pnpm ≥ 9.x |
| Containerization | Docker + Docker Compose | Docker ≥ 24.x |
| CI/CD | GitHub Actions | N/A |

### 3.2 Architecture Constraints

- **No microservices in v1.0** — All backend logic runs in a single Express.js application. BullMQ workers run as separate process forks from the same codebase, not separate services.
- **No GraphQL** — All APIs are REST with JSON. GraphQL is not used in v1.0.
- **No server-side rendering** — The frontend is a pure SPA. Server-side rendering (Next.js, Remix) is not in scope.
- **Shared database** — Multi-tenancy is implemented via `organizationId` field on all documents; there is no per-tenant database or collection.
- **No external CDN requirement** — Static assets are served from the Vite build output; no S3/CloudFront dependency.
- **Turborepo pipeline** — All build, lint, and test commands MUST be orchestrated via `turbo.json` task definitions.

### 3.3 Security Constraints

- Private keys for JWT signing MUST be rotated during deployment; a 24-hour grace period for old tokens applies
- `SECRET_ENCRYPTION_KEY` rotation requires a secret migration job (out of scope for v1.0; a warning MUST be documented)
- All external-facing HTTP endpoints MUST go through the auth middleware before the route handler
- No API endpoint MAY return a MongoDB internal error message to the client; all DB errors MUST be mapped to standard error responses

---

## 4. Assumptions

1. **Development environment parity** — Docker Compose brings up MongoDB and Redis with the same version as production. Developers do not install MongoDB or Redis locally outside of Docker.
2. **Single-region deployment** — All services (API, MongoDB, Redis) run in the same region. Cross-region latency is not a factor in v1.0 performance budgets.
3. **English-only interface** — No internationalization (i18n) is required. All user-facing text is in English.
4. **Synchronous audit writes are fast** — MongoDB write latency is assumed to be < 5ms on the local Docker network. This assumption allows audit writes to be synchronous without exceeding the p99 latency budget.
5. **Email provider availability** — The email provider (SMTP/SendGrid) is assumed to be available. Temporary unavailability is handled by BullMQ retry; permanent unavailability requires manual intervention outside the application.
6. **Simulated deployment pipeline** — The BullMQ deployment worker uses `setTimeout` to simulate build and deploy phases. No actual container builds, image pushes, or cloud deployments are performed. This is explicitly documented in the README.
7. **Single org per user (practical)** — The data model supports users belonging to multiple organizations, but the v1.0 UI focuses on a single active org context at a time.
8. **No secret version history** — Secret values are overwritten on update. The current value is the only value stored. History is considered a v2 feature.
9. **No high-availability Redis** — A single Redis instance is used. Redis failure results in BullMQ and Socket.IO unavailability. This is acceptable for v1.0.

---

## 5. External Dependencies

### 5.1 Runtime Dependencies

| Dependency | Purpose | Version | Configuration |
|---|---|---|---|
| **MongoDB** | Primary document store | ≥ 7.0 | `MONGODB_URI` env var |
| **Redis** | BullMQ queue backend + Socket.IO pub/sub | ≥ 7.0 | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` env vars |
| **BullMQ** | Async job queue (deployments, webhooks, emails) | ≥ 5.x | Requires Redis |
| **Socket.IO** | Real-time bidirectional event delivery | ≥ 4.x | Requires Redis adapter for multi-process |
| **@socket.io/redis-adapter** | Socket.IO Redis pub/sub adapter | Latest | Requires Redis |
| **SMTP / SendGrid** | Transactional email delivery | Any SMTP-compliant | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` or `SENDGRID_API_KEY` |
| **Docker** | Container runtime for all services | ≥ 24.x | `docker-compose.yml` |

### 5.2 Build-Time Dependencies

| Dependency | Purpose |
|---|---|
| **pnpm** | Package manager (workspace support) |
| **Turborepo** | Monorepo build orchestration with caching |
| **Vite** | Frontend dev server + production bundler |
| **TypeScript** | Type-safe compilation for all packages |
| **ESLint** | Static analysis (frontend + backend) |
| **Vitest** | Unit and integration test runner (backend) |
| **Supertest** | HTTP integration test client |
| **Playwright** | End-to-end browser test runner |

### 5.3 Required Environment Variables

| Variable | Module | Description |
|---|---|---|
| `MONGODB_URI` | Core | MongoDB connection string |
| `REDIS_HOST` | Core | Redis hostname |
| `REDIS_PORT` | Core | Redis port (default: 6379) |
| `REDIS_PASSWORD` | Core | Redis auth password (optional) |
| `JWT_PRIVATE_KEY` | Auth | RS256 private key (PEM format) |
| `JWT_PUBLIC_KEY` | Auth | RS256 public key (PEM format) |
| `JWT_ACCESS_EXPIRY` | Auth | Access token TTL (default: `15m`) |
| `JWT_REFRESH_EXPIRY` | Auth | Refresh token TTL (default: `7d`) |
| `SECRET_ENCRYPTION_KEY` | Secrets | 32-byte AES-256 key (hex or base64) |
| `CORS_ORIGIN` | API | Allowed frontend origin |
| `NODE_ENV` | Core | `development` / `production` |
| `PORT` | API | Express server port (default: `4000`) |
| `SMTP_HOST` | Notifications | Email server hostname |
| `SMTP_PORT` | Notifications | Email server port |
| `SMTP_USER` | Notifications | Email server username |
| `SMTP_PASS` | Notifications | Email server password |
| `WORKER_CONCURRENCY` | Workers | BullMQ worker job concurrency (default: `5`) |

All variables MUST be declared in `.env.example` with placeholder values and documented inline.

---

## 6. API Contracts Reference

All SELADEV REST APIs conform to the conventions defined in [`api-design.md`](./api-design.md). Key contracts:

### 6.1 URL Structure

```
/api/v1/<resource>                         # Collection
/api/v1/<resource>/:id                     # Document
/api/v1/<parent>/:parentId/<child>         # Nested resource
/api/v1/<resource>/:id/<action>            # Action endpoint
```

### 6.2 Standard Success Envelope

```typescript
// Single resource
{ "success": true, "data": { ...resource } }

// Collection
{ "success": true, "data": [...items], "pagination": { "nextCursor": string | null, "hasMore": boolean } }

// Empty response
// HTTP 204 No Content (no body)
```

### 6.3 Standard Error Envelope

```typescript
{
  "success": false,
  "error": {
    "code": string,        // e.g. "VALIDATION_ERROR", "UNAUTHORIZED", "NOT_FOUND"
    "message": string,     // Human-readable message (not internal DB error)
    "details"?: unknown[]  // Field-level errors for 422 responses
  }
}
```

### 6.4 HTTP Status Code Conventions

| Code | Usage |
|---|---|
| `200 OK` | Successful GET, PUT |
| `201 Created` | Successful POST that creates a resource |
| `204 No Content` | Successful DELETE or action with no body |
| `400 Bad Request` | Malformed request syntax |
| `401 Unauthorized` | Missing or invalid authentication |
| `403 Forbidden` | Authenticated but insufficient permission |
| `404 Not Found` | Resource does not exist |
| `409 Conflict` | Duplicate resource or state conflict |
| `422 Unprocessable Entity` | Validation failure (field-level errors in `details`) |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unhandled server error |
| `503 Service Unavailable` | Dependency (Redis/Mongo) unavailable |

### 6.5 OpenAPI Specification

The OpenAPI 3.0 specification MUST be maintained in `apps/api/openapi.yaml`. Swagger UI is served at `GET /api/docs`. The specification MUST be updated as part of any PR that adds or modifies an endpoint — this is enforced in code review, not automatically validated in CI (v1.0 constraint).

---

## 7. Data Retention Requirements

| Data Category | Retention Period | Policy |
|---|---|---|
| **User accounts** | Indefinite (while org active) | Soft-deleted on removal; hard deletion on org deletion |
| **Secrets** | Indefinite (while project active) | Soft-deleted; not hard-deleted in v1.0 |
| **Audit logs** | **Minimum 1 year** | MUST NOT be deleted or modified; append-only |
| **Deployment history** | 90 days active; archived after | No deletion in v1.0; pagination prevents performance issues |
| **Notifications** | 30 days | Notifications older than 30 days MAY be purged by a maintenance job |
| **Webhook delivery logs** | 14 days | Delivery logs older than 14 days MAY be purged |
| **Dead letter queue entries** | 30 days | DLQ entries older than 30 days MAY be purged |
| **API keys (revoked)** | 90 days | Revoked keys are retained for audit trail; purged after 90 days |
| **Refresh tokens** | Until expiry + 24 hours | Expired tokens MUST be purged by a scheduled job to prevent collection bloat |

**Data purge implementation:** All purge operations MUST be implemented as scheduled BullMQ jobs (cron-based), not triggered by API requests. Purge jobs MUST log their execution to the application logger with count of deleted records.

---

## 8. Compliance Requirements

### 8.1 Secret Encryption at Rest (Mandatory)

All secret values persisted to MongoDB MUST be encrypted using AES-256-GCM. This requirement is non-negotiable. Evidence of compliance:

- `Secret` Mongoose schema stores `encryptedValue` (Buffer/string), `iv` (hex string), and `authTag` (hex string)
- The `SecretRepository` `create` and `update` methods MUST call the `EncryptionService` before writing
- The `EncryptionService` MUST use `crypto.createCipheriv('aes-256-gcm', key, iv)` from Node.js built-in `crypto`
- No third-party encryption library is required — Node.js built-in crypto is the standard

### 8.2 Audit Log Immutability (Mandatory)

The audit log MUST function as an append-only ledger. Compliance evidence:

- `AuditLogRepository` exposes ONLY `create(entry: CreateAuditLogDto): Promise<AuditLog>` and `findMany(filter): Promise<AuditLog[]>` methods
- No `update`, `delete`, `updateOne`, `deleteOne`, or equivalent methods exist on the repository interface
- TypeScript interface `IAuditLogRepository` MUST enforce this at the type level
- MongoDB Atlas MAY be configured with a separate read-only user for audit log access by compliance tooling

### 8.3 Refresh Token Security (Mandatory)

Refresh tokens MUST NOT be stored in plaintext. Compliance evidence:

- On issuance, the refresh token is hashed with SHA-256 before database write
- The raw token is delivered to the client via `HttpOnly; Secure; SameSite=Strict` cookie only
- On use, the incoming token is hashed and compared against stored hashes
- Token family tracking enables replay attack detection and full family invalidation

### 8.4 API Key Security (Mandatory)

API key raw values MUST NOT be stored. Compliance evidence:

- On issuance, `crypto.randomBytes(32)` generates the raw value; SHA-256 hash is stored
- Raw value is returned once in the `201 Created` response and never again
- Authentication via API key: incoming value is hashed and compared against stored hashes
- `keyPreview` (last 4 chars) is stored for identification purposes only

### 8.5 Input Validation (Mandatory)

All incoming API request data (body, query params, path params) MUST be validated using Zod schemas before reaching the service layer. Compliance evidence:

- A `validate(schema)` middleware factory MUST be applied on every route
- Zod parse failures MUST return `422 Unprocessable Entity` with field-level `details`
- MongoDB ObjectId path params MUST be validated for format before querying the database

### 8.6 OWASP Top 10 Mitigations

Full security design documentation is maintained in [`security.md`](./security.md). Summary of v1.0 mitigations:

| OWASP 2021 Category | SELADEV Mitigation |
|---|---|
| A01 Broken Access Control | RBAC middleware on every protected route; org + project scope validation |
| A02 Cryptographic Failures | AES-256-GCM for secrets; RS256 JWT; SHA-256 key hashing; HTTPS in prod |
| A03 Injection | Zod input validation; Mongoose parameterized queries; no string interpolation |
| A04 Insecure Design | Clean Architecture enforces separation of concerns; no business logic in routes |
| A05 Security Misconfiguration | Security headers via `helmet`; strict CORS; env vars validated at startup |
| A06 Vulnerable Components | `pnpm audit` in CI; Dependabot enabled on GitHub repo |
| A07 Auth & Session Failures | RS256 JWT; refresh rotation; rate limiting; bcrypt cost ≥ 12 |
| A08 Software & Data Integrity | HMAC-SHA256 webhook signing; audit log immutability |
| A09 Security Logging Failures | Synchronous audit log writes; structured logging with `pino` |
| A10 SSRF | Webhook URL validation (no private IP ranges allowed); allowlist in prod |

---

*Document version: 1.0.0 — Last updated: June 2026*
*Author: SELADEV Engineering*
*Cross-references: [00-project-overview.md](./00-project-overview.md) · [01-prd.md](./01-prd.md) · [auth-design.md](./auth-design.md) · [database-design.md](./database-design.md) · [api-design.md](./api-design.md) · [security.md](./security.md)*
