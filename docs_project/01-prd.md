# SELADEV — Product Requirements Document (PRD)

> **Document type:** Product Requirements Document
> **Status:** Approved — v1.0
> **Audience:** Engineering Lead, Product Owner, Senior Engineers, QA

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [User Personas](#4-user-personas)
5. [User Stories & Acceptance Criteria](#5-user-stories--acceptance-criteria)
   - 5.1 Authentication & Identity
   - 5.2 Organizations & Members
   - 5.3 Projects & Environments
   - 5.4 Secrets & Config
   - 5.5 API Keys
   - 5.6 Deployments
   - 5.7 Webhooks
   - 5.8 Audit Logs
   - 5.9 Notifications
6. [Feature Priority (MoSCoW)](#6-feature-priority-moscow)
7. [Out of Scope](#7-out-of-scope)
8. [Success Metrics (KPIs)](#8-success-metrics-kpis)
9. [Dependencies & Assumptions](#9-dependencies--assumptions)

---

## 1. Executive Summary

SELADEV is an Internal Developer Platform (IDP) that consolidates the operational surface of software delivery — secrets, deployments, API keys, access control, audit logs, and notifications — into a single web-based control plane.

The platform targets engineering organizations of 5–200 engineers where the operational tooling has fragmented across multiple disconnected systems (secret managers, CI dashboards, spreadsheets, Slack bots). SELADEV replaces that fragmentation with a unified, role-aware, real-time system that every engineer on the team can use according to their responsibilities.

This PRD defines what SELADEV v1.0 must do, for whom, at what priority, and how success will be measured. It is the single source of truth for feature scope for the initial release.

---

## 2. Problem Statement

### 2.1 The Core Problem

Engineering teams lack a unified platform for managing the operational runtime of their software products. Secrets, access control, deployment status, API key lifecycle, and compliance audit are managed in separate tools with separate access models and no shared context.

### 2.2 Specific User Pain Points

#### Platform Engineers / DevOps Leads
- Must manually provision access in 4–6 systems for every new engineer onboard
- Cannot see a unified audit trail of who changed what secret/key/config and when
- Cannot enforce consistent secret rotation policies across teams
- Must manually configure webhook delivery to downstream tools with no retry visibility
- Must context-switch between cloud consoles, CI dashboards, and spreadsheets to understand deployment health

#### Team Leads
- Cannot see deployment status for their team without DevOps access
- Cannot onboard a new developer to a project without filing tickets
- Cannot view secrets for their environment without asking DevOps
- Cannot tell from current tooling who last modified a critical environment variable
- Have no real-time visibility into failed deployments without monitoring CI notifications

#### Application Developers
- Cannot retrieve the API keys or secrets they need without filing a request or getting admin help
- Receive no structured notification when their deployment fails or a secret they depend on is rotated
- Cannot confirm whether their deployment is running, queued, or failed without being on the CI platform
- Have no self-service capability — everything requires escalation

### 2.3 Business Impact

| Pain Point | Business Cost |
|---|---|
| Manual access provisioning | 2–3 days of DevOps time per engineer onboard |
| No audit trail | Compliance gaps; incident investigation takes hours |
| No deployment visibility | Developer productivity blocked on CI access |
| Secret sprawl | Security exposure from untracked keys and values |
| Ad-hoc notifications | Silent failures; delayed incident response |

---

## 3. Goals & Non-Goals

### 3.1 Goals (v1.0)

1. **Unified identity and access** — JWT-based authentication with org-level and project-level RBAC that governs every operation on the platform
2. **Project and environment management** — A multi-tenant project model where each project has distinct environments with isolated secrets
3. **Encrypted secret storage** — Store, retrieve (masked by default), and manage secrets encrypted at rest using AES-256-GCM
4. **API key lifecycle management** — Issue, describe, scope, rotate, and expire API keys with full audit trail
5. **Deployment pipeline** — Queue and execute deployment jobs with real-time status updates via Socket.IO
6. **Webhook event delivery** — Deliver signed, retried, dead-letter-tracked webhooks to external endpoints
7. **Immutable audit log** — Record every state-changing operation with actor context, enforced at the repository layer
8. **Real-time notifications** — Deliver in-app and email notifications for platform events via BullMQ + Socket.IO
9. **Usage analytics** — Surface deployment frequency, error rate, and API key usage to authorized users
10. **OpenAPI documentation** — Full API spec documentation for all endpoints via Swagger UI

### 3.2 Non-Goals (v1.0)

1. **No CI/CD pipeline execution** — SELADEV does not run build agents or compile code
2. **No external secret sync** — No integration with AWS Secrets Manager, HashiCorp Vault, or Doppler
3. **No Git integration** — No repository linking, commit status callbacks, or branch-based deployments
4. **No billing system** — No subscription management, payment processing, or plan tier gating
5. **No mobile application** — The platform is web-only in v1.0
6. **No Kubernetes or infrastructure provisioning** — SELADEV does not deploy to or manage cloud infrastructure
7. **No feature flag system** — Secret management is configuration storage, not runtime feature toggling
8. **No white-labeling** — No custom branding per tenant in v1.0

---

## 4. User Personas

### Persona 1 — Anya Reyes, Platform Engineer

| Attribute | Detail |
|---|---|
| **Role** | Platform Engineering Lead |
| **Org size** | 60 engineers, 8 product squads |
| **Tools today** | AWS Secrets Manager, GitHub Actions, Slack, spreadsheets for API keys |
| **Technical level** | Expert — writes Terraform, manages Kubernetes clusters |

**Goals:**
- Single pane of glass for all operational tooling
- Enforced audit trail for compliance (SOC 2 prep)
- Self-service access for team leads without routing through her
- Webhook integration so SELADEV events trigger existing Slack and PagerDuty workflows

**Frustrations:**
- Spends 30% of her time handling access requests and "what's the secret for X environment?" questions
- Cannot produce an audit trail on demand for security reviews
- API key rotation is manual; no expiry enforcement exists

**Success for Anya:** She configures SELADEV once, delegates project admin to team leads, and her team's access/audit questions drop to near zero.

---

### Persona 2 — Marcus Chen, Engineering Team Lead

| Attribute | Detail |
|---|---|
| **Role** | Backend Engineering Lead, Payments Squad |
| **Org size** | 60 engineers, manages a squad of 8 |
| **Tools today** | Jira, GitHub, Confluence, Slack |
| **Technical level** | Senior engineer, comfortable with infrastructure concepts |

**Goals:**
- Onboard new developers to his project quickly without filing DevOps tickets
- Monitor his squad's deployments without needing CI admin access
- Manage secrets for his environments without routing every request through Anya
- Get notified immediately when a production deployment fails

**Frustrations:**
- Onboarding a new developer takes 3–5 days of back-and-forth with DevOps
- Deployment status requires checking GitHub Actions + a separate deployment tool
- Cannot see who changed a production secret or when

**Success for Marcus:** He manages his project end-to-end. Onboarding a developer takes under 3 minutes. He gets a push notification the moment a production deployment fails.

---

### Persona 3 — Priya Nair, Application Developer

| Attribute | Detail |
|---|---|
| **Role** | Mid-level fullstack engineer |
| **Org size** | 60 engineers, member of Payments squad |
| **Tools today** | VS Code, GitHub, Slack |
| **Technical level** | Mid-level, not familiar with infrastructure tooling |

**Goals:**
- Know the secrets/env vars her application needs without asking Marcus or Anya
- See the status of her deployment without having to check CI
- Get notified when her deployment succeeds or fails
- Use her API key without needing admin access to see it

**Frustrations:**
- Getting a secret or API key requires sending a Slack message and waiting hours
- She has no idea if her deployment queued, failed, or succeeded without pinging DevOps
- She accidentally committed a secret to Git once because she didn't know where the actual values were

**Success for Priya:** She views her project's secrets (masked), triggers a deployment, and receives a real-time notification — all without asking anyone for help.

---

## 5. User Stories & Acceptance Criteria

### 5.1 Authentication & Identity

---

**US-AUTH-01: User Registration**

> As a new user, I want to register with my email and password so that I can access SELADEV.

**Acceptance Criteria:**
- `POST /api/v1/auth/register` accepts `{ name, email, password }`
- Password is hashed with bcrypt (cost factor ≥ 12) before storage
- Email must be unique; duplicate registration returns `409 Conflict` with a descriptive error
- Successful registration returns a `201 Created` with the user object (no password field)
- A verification email is sent asynchronously (non-blocking to API response)
- Input is validated with Zod; invalid input returns `422 Unprocessable Entity` with field-level errors

---

**US-AUTH-02: User Login**

> As a registered user, I want to log in with my email and password so that I receive access and refresh tokens.

**Acceptance Criteria:**
- `POST /api/v1/auth/login` accepts `{ email, password }`
- Returns a short-lived RS256 JWT access token (15-minute expiry) in response body
- Returns a rotating refresh token (7-day expiry) in an `HttpOnly; Secure; SameSite=Strict` cookie
- Invalid credentials return `401 Unauthorized` (no differentiation between wrong email and wrong password)
- Rate limiting applies: max 5 failed attempts per IP per 15 minutes before `429 Too Many Requests`
- Successful login creates an audit log entry: `actor=user, action=auth.login, resource=user`

---

**US-AUTH-03: Token Refresh**

> As a logged-in user, I want my session to refresh silently so that I don't get logged out mid-session.

**Acceptance Criteria:**
- `POST /api/v1/auth/refresh` reads the refresh token from the HttpOnly cookie
- Returns a new access token and rotates the refresh token (old token is invalidated)
- Replay of an already-used refresh token returns `401 Unauthorized` and invalidates the entire token family (rotation detection)
- Expired refresh tokens return `401 Unauthorized` with code `REFRESH_TOKEN_EXPIRED`

---

**US-AUTH-04: Logout**

> As a logged-in user, I want to log out so that my session is immediately invalidated.

**Acceptance Criteria:**
- `POST /api/v1/auth/logout` invalidates the refresh token in the database
- Clears the HttpOnly cookie on response
- Returns `204 No Content`
- Subsequent use of the invalidated refresh token returns `401 Unauthorized`

---

**US-AUTH-05: Password Change**

> As a logged-in user, I want to change my password so that I can maintain account security.

**Acceptance Criteria:**
- `PUT /api/v1/auth/password` requires current password and new password
- New password must satisfy policy: min 8 chars, at least 1 uppercase, 1 number, 1 symbol
- All active refresh tokens for the user are invalidated on successful password change
- Returns `200 OK` with a confirmation message

---

### 5.2 Organizations & Members

---

**US-ORG-01: Create Organization**

> As a registered user, I want to create an organization so that I can manage projects and team members under a named tenant.

**Acceptance Criteria:**
- `POST /api/v1/organizations` accepts `{ name, slug }` where slug is URL-safe and unique
- The creating user is automatically assigned the `org_admin` role in the new organization
- Slug conflicts return `409 Conflict`
- Returns `201 Created` with the organization object

---

**US-ORG-02: Invite a Member**

> As an org admin, I want to invite a user to my organization so that they can access org-level resources.

**Acceptance Criteria:**
- `POST /api/v1/organizations/:orgId/members` accepts `{ email, role }` where role is one of `org_admin | member`
- If the email does not correspond to a registered user, an invitation email is sent
- If the user is already a member, returns `409 Conflict`
- The new member appears in `GET /api/v1/organizations/:orgId/members` immediately
- Only `org_admin` may invite members; others receive `403 Forbidden`

---

**US-ORG-03: Remove a Member**

> As an org admin, I want to remove a member from my organization so that their access is revoked.

**Acceptance Criteria:**
- `DELETE /api/v1/organizations/:orgId/members/:userId` removes org membership
- All project-level role assignments for this user within the org are also removed atomically
- The user cannot access any org or project resource after removal
- An org admin cannot remove themselves if they are the sole admin (returns `422`)
- Removal is audit-logged

---

### 5.3 Projects & Environments

---

**US-PROJ-01: Create Project**

> As an org admin or project admin, I want to create a project so that my team has a scoped workspace for their service.

**Acceptance Criteria:**
- `POST /api/v1/organizations/:orgId/projects` accepts `{ name, slug, description }`
- Default environments `development`, `staging`, `production` are created automatically
- The creator is assigned `project_admin` on the new project
- Slug must be unique within the org; duplicates return `409 Conflict`

---

**US-PROJ-02: Manage Project Environments**

> As a project admin, I want to create, rename, and delete environments so that I can control my deployment topology.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/environments` accepts `{ name, slug }`
- `PUT /api/v1/projects/:projectId/environments/:envId` allows renaming
- `DELETE /api/v1/projects/:projectId/environments/:envId` deletes the environment and all its secrets (with confirmation required in request body)
- Deleting an environment with active deployments returns `409 Conflict`

---

**US-PROJ-03: Assign Project Role**

> As a project admin, I want to assign a role to an org member on my project so that they have the correct level of access.

**Acceptance Criteria:**
- `PUT /api/v1/projects/:projectId/members/:userId` accepts `{ role }` — one of `project_admin | developer | viewer`
- The user must already be an org member; assigning a non-member returns `422`
- Role changes take effect immediately on the next API request
- Role assignment is audit-logged with both old and new role in metadata

---

### 5.4 Secrets & Config

---

**US-SEC-01: Create Secret**

> As a project admin, I want to create a secret for a specific environment so that my team's services can reference it.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/environments/:envId/secrets` accepts `{ key, value, description?, expiresAt? }`
- Value is encrypted with AES-256-GCM before database write; plaintext is never persisted
- Key must be unique within the environment; duplicates return `409 Conflict`
- Key format must match `[A-Z][A-Z0-9_]*` (snake_case uppercase); invalid format returns `422`
- Creation is audit-logged with key name but never with plaintext value

---

**US-SEC-02: List Secrets (Masked)**

> As a developer, I want to list secrets for my environment so that I know what keys exist without seeing values.

**Acceptance Criteria:**
- `GET /api/v1/projects/:projectId/environments/:envId/secrets` returns all secrets with `value: "****"` for `developer` and `viewer` roles
- `project_admin` and `org_admin` also see masked values by default (reveal is a separate action)
- Response includes: `id`, `key`, `description`, `expiresAt`, `createdAt`, `updatedAt`, `createdBy`

---

**US-SEC-03: Reveal Secret Value**

> As a project admin, I want to reveal the plaintext value of a secret so that I can verify its contents.

**Acceptance Criteria:**
- `GET /api/v1/projects/:projectId/environments/:envId/secrets/:secretId/reveal` returns `{ value: "<plaintext>" }`
- Only `project_admin`, `org_admin` can call this endpoint; `developer` and `viewer` receive `403 Forbidden`
- Every reveal action is audit-logged: actor, secret key, environment, timestamp
- Plaintext is never stored in logs

---

**US-SEC-04: Update Secret Value**

> As a project admin, I want to update a secret value so that I can rotate it without deleting and recreating.

**Acceptance Criteria:**
- `PUT /api/v1/projects/:projectId/environments/:envId/secrets/:secretId` accepts `{ value, description?, expiresAt? }`
- New value is re-encrypted with a fresh IV; old ciphertext is overwritten
- Update is audit-logged with key name and a `value_changed: true` flag (never the plaintext value)

---

**US-SEC-05: Delete Secret**

> As a project admin, I want to delete a secret that is no longer in use.

**Acceptance Criteria:**
- `DELETE /api/v1/projects/:projectId/environments/:envId/secrets/:secretId` soft-deletes the record
- Deleted secrets do not appear in list responses
- Deletion is audit-logged

---

### 5.5 API Keys

---

**US-KEY-01: Issue an API Key**

> As a project admin, I want to issue a scoped API key so that services and CI pipelines can authenticate with SELADEV.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/api-keys` accepts `{ name, scopes: string[], expiresAt? }`
- Valid scopes: `deployments:read`, `deployments:write`, `secrets:read`, `webhooks:read`, `webhooks:write`
- The full key value is returned **only once** at creation time in the response body
- The stored key is a SHA-256 hash of the raw value; the raw value is never stored
- Returns `201 Created` with `{ id, name, keyPreview: "sk_...xxxx", scopes, expiresAt, createdAt }`
- Issuance is audit-logged

---

**US-KEY-02: List API Keys**

> As a project admin, I want to list all API keys for my project so that I can manage their lifecycle.

**Acceptance Criteria:**
- `GET /api/v1/projects/:projectId/api-keys` returns all keys with `keyPreview` (last 4 chars) but never full values
- Response includes `name`, `scopes`, `expiresAt`, `lastUsedAt`, `isExpired`, `createdBy`
- Expired keys are included in the list but flagged with `isExpired: true`

---

**US-KEY-03: Rotate an API Key**

> As a project admin, I want to rotate an API key so that the old key is immediately invalidated and a new one is issued.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/api-keys/:keyId/rotate` atomically invalidates the old key and issues a new one
- The new key inherits the same `name`, `scopes`, and `expiresAt` as the rotated key
- The new raw key value is returned once in the response
- Rotation is audit-logged; old key ID and new key ID are recorded in metadata

---

**US-KEY-04: Revoke an API Key**

> As a project admin, I want to revoke an API key immediately so that a leaked key cannot be used.

**Acceptance Criteria:**
- `DELETE /api/v1/projects/:projectId/api-keys/:keyId` immediately sets `revokedAt` on the key
- Revoked keys fail authentication with `401 Unauthorized` and code `API_KEY_REVOKED`
- Revocation is audit-logged with urgency flag

---

### 5.6 Deployments

---

**US-DEP-01: Trigger a Deployment**

> As a developer or project admin, I want to trigger a deployment for a project environment so that my latest changes are deployed.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/environments/:envId/deployments` accepts `{ version, metadata? }`
- A BullMQ job is enqueued; the response returns immediately with status `QUEUED` and a `deploymentId`
- Response time for enqueueing must be < 500ms regardless of queue depth
- Only roles `developer` and above can trigger deployments

---

**US-DEP-02: Track Deployment Status in Real Time**

> As a developer, I want to see the live status of my deployment so that I know when it completes or fails without refreshing.

**Acceptance Criteria:**
- Deployment status transitions (`QUEUED → BUILDING → DEPLOYING → SUCCESS | FAILED | CANCELLED`) are emitted as Socket.IO events to the client room `deployment:{deploymentId}`
- The UI updates status in real time within 500ms of the server event
- `GET /api/v1/projects/:projectId/environments/:envId/deployments/:deploymentId` returns current status for polling fallback
- Each status transition is recorded with a timestamp in the deployment record

---

**US-DEP-03: View Deployment History**

> As a team lead, I want to see the deployment history for an environment so that I can review recent changes.

**Acceptance Criteria:**
- `GET /api/v1/projects/:projectId/environments/:envId/deployments` returns paginated deployment history
- Each record includes: `id`, `status`, `version`, `triggeredBy`, `startedAt`, `completedAt`, `duration`
- Supports query parameters: `status`, `limit`, `cursor` (cursor-based pagination)
- History is ordered by `startedAt` descending

---

**US-DEP-04: Cancel a Queued Deployment**

> As a project admin, I want to cancel a queued or building deployment so that I can prevent an unintended release.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/environments/:envId/deployments/:deploymentId/cancel` transitions status to `CANCELLED`
- Only `QUEUED` or `BUILDING` deployments can be cancelled; `DEPLOYING` and terminal states return `422`
- Cancellation is audit-logged

---

### 5.7 Webhooks

---

**US-WH-01: Register a Webhook**

> As a project admin, I want to register a webhook endpoint so that external systems are notified of platform events.

**Acceptance Criteria:**
- `POST /api/v1/projects/:projectId/webhooks` accepts `{ url, events: string[], secret?, description? }`
- Valid events: `deployment.queued`, `deployment.succeeded`, `deployment.failed`, `deployment.cancelled`, `secret.created`, `secret.updated`, `secret.deleted`, `api_key.rotated`, `api_key.revoked`
- If `secret` is not provided, SELADEV generates a random 32-byte hex signing secret and returns it once
- The endpoint URL must be reachable (an optional test ping is sent on registration)

---

**US-WH-02: Webhook Payload Delivery**

> As a platform user, I want webhook payloads to be delivered reliably so that downstream systems stay in sync.

**Acceptance Criteria:**
- Payloads are delivered via HTTP POST to the registered URL within 10 seconds of the triggering event
- Payload body is signed: `X-SELADEV-Signature: sha256=<hmac>` header is included
- Recipient can verify signature using the shared secret: `HMAC-SHA256(secret, JSON.stringify(body))`
- Delivery attempts and responses are recorded per webhook call

---

**US-WH-03: Webhook Retry & Dead Letter**

> As a project admin, I want failed webhook deliveries to be retried so that transient failures don't cause missed events.

**Acceptance Criteria:**
- Failed deliveries (non-2xx response or timeout) are retried with exponential backoff: 30s, 2m, 10m, 1h
- After 4 failed attempts, the delivery is moved to the dead letter queue
- Dead letter entries are visible via `GET /api/v1/projects/:projectId/webhooks/:webhookId/dead-letters`
- A manual replay action is available: `POST /api/v1/projects/:projectId/webhooks/:webhookId/dead-letters/:dlqId/replay`

---

### 5.8 Audit Logs

---

**US-AUD-01: View Audit Log**

> As an org admin or project admin, I want to view the audit log so that I can see who did what and when.

**Acceptance Criteria:**
- `GET /api/v1/organizations/:orgId/audit-logs` returns paginated audit entries for the org
- `GET /api/v1/projects/:projectId/audit-logs` returns paginated audit entries for the project
- Each entry includes: `id`, `actor` (id, email, role), `action`, `resource` (type, id), `metadata`, `ipAddress`, `userAgent`, `createdAt`
- Supports filtering by: `action`, `resourceType`, `actorId`, `from`, `to`
- Supports cursor-based pagination with `limit` (max 100 per page)

---

**US-AUD-02: Audit Log Immutability**

> As a platform operator, I need the audit log to be immutable so that it can be trusted for compliance purposes.

**Acceptance Criteria:**
- No API endpoint exists for deleting or updating audit log entries
- The `AuditLog` MongoDB collection has no update or delete operations in the repository layer
- An attempt to call any hypothetical update/delete directly on the collection fails at the service layer by design
- Audit log entries are created synchronously before the API response is sent (not via a queue)

---

### 5.9 Notifications

---

**US-NOT-01: Real-Time In-App Notification**

> As a developer, I want to receive real-time in-app notifications for platform events relevant to me so that I stay informed without constantly checking dashboards.

**Acceptance Criteria:**
- Notifications are pushed via Socket.IO to the authenticated user's socket room (`user:{userId}`)
- Notification types include: `deployment.succeeded`, `deployment.failed`, `secret.expiring`, `api_key.expiring`, `webhook.failed`, `role.changed`
- Unread count is visible in the UI header, updates in real time
- `GET /api/v1/notifications` returns paginated notification history
- `PUT /api/v1/notifications/:notificationId/read` marks a notification as read
- `PUT /api/v1/notifications/read-all` marks all as read

---

**US-NOT-02: Email Notification Delivery**

> As a user, I want to receive email notifications for critical events so that I'm informed even when not actively using SELADEV.

**Acceptance Criteria:**
- Email is delivered asynchronously via BullMQ worker (non-blocking to the triggering action)
- Email is sent to the user's registered email address
- Critical events that always trigger email: `deployment.failed` (in `production` environment), `api_key.expiring` (7 days before expiry), `secret.expiring` (7 days before expiry)
- Non-critical events respect user notification preferences
- Email delivery failure does not affect the primary platform operation

---

**US-NOT-03: Notification Preferences**

> As a user, I want to control which notifications I receive so that I'm not overwhelmed by noise.

**Acceptance Criteria:**
- `GET /api/v1/users/me/notification-preferences` returns current preferences per category
- `PUT /api/v1/users/me/notification-preferences` accepts `{ [category]: { inApp: boolean, email: boolean } }`
- Preferences are respected for all non-critical notification types
- Critical security events (role revoked, account locked) cannot be disabled

---

## 6. Feature Priority (MoSCoW)

### Must Have (MVP — Launch Blockers)

| Feature | Rationale |
|---|---|
| User registration & login (JWT + refresh) | Platform is unusable without auth |
| Organization creation and member management | Multi-tenancy foundation |
| Project creation with default environments | Core workspace unit |
| Secret CRUD with AES-256-GCM encryption | Core value proposition |
| Project-level RBAC enforcement | Security requirement |
| Deployment trigger and status tracking | Core platform feature |
| Real-time deployment status via Socket.IO | DX differentiator |
| Immutable audit log (write on every mutation) | Compliance requirement |
| API key issuance and validation | Service-to-service auth |
| OpenAPI / Swagger documentation | Developer experience requirement |

### Should Have (High Value — Ship Soon After MVP)

| Feature | Rationale |
|---|---|
| API key rotation and revocation | Security lifecycle completeness |
| Webhook registration and signed delivery | Integration completeness |
| Webhook retry with dead letter queue | Reliability requirement |
| In-app notifications via Socket.IO | DX quality |
| Email notifications via BullMQ | Critical event awareness |
| Secret reveal with audit trail | Workflow completeness |
| Deployment cancellation | Operational control |
| Audit log filtering and search | Compliance usability |
| Analytics dashboard (deployment frequency, error rate) | Platform visibility |

### Could Have (Nice to Have — Ship When Capacity Allows)

| Feature | Rationale |
|---|---|
| Secret expiry warnings | Proactive secret hygiene |
| Bulk secret import (JSON/env file) | Onboarding acceleration |
| Notification preferences per category | User comfort |
| Webhook delivery logs and history | Debugging support |
| API key `lastUsedAt` tracking | Security visibility |
| Environment cloning (copy secrets) | Productivity shortcut |

### Won't Have (Out of Scope for v1.0)

| Feature | Rationale |
|---|---|
| Git repository integration | Out of scope — not an IDP architecture requirement for v1 |
| External secret sync (Vault, SSM) | Significant scope increase, separate product surface |
| Mobile application | Resource constraint; web is sufficient for target users |
| Billing and plan management | No commercial model required for portfolio scope |
| Custom domain per tenant | Infrastructure complexity not needed for v1 |
| SSO / SAML / OIDC federation | Significant scope; v2 consideration |
| Secret versioning history | Storage complexity; could have in v2 |
| Two-factor authentication | Important but scoped out of v1 |

---

## 7. Out of Scope

The following are explicitly excluded from SELADEV v1.0 to maintain a focused, shippable scope:

- **CI/CD execution** — No build runners, no GitHub Actions integration, no artifact management
- **Infrastructure provisioning** — No Terraform, no Kubernetes, no cloud resource management
- **External secret store sync** — All secrets live in SELADEV's own encrypted store
- **SOC 2 / ISO 27001 certification** — The design supports compliance patterns but certification is out of scope
- **Multi-region deployment** — Single-region MongoDB and Redis in v1.0
- **Database backup and recovery UI** — Operational concern managed at infrastructure level
- **Custom email templates** — Functional templates only; no drag-and-drop designer
- **Rate limiting per tenant** — Global rate limiting only in v1.0; per-org quotas are v2

---

## 8. Success Metrics (KPIs)

### Engagement Metrics

| KPI | Definition | Target |
|---|---|---|
| Time-to-first-deployment | Minutes from org creation to first successful deployment | < 5 minutes |
| Developer self-service rate | % of secret/key requests fulfilled without admin intervention | > 80% |
| Notification open rate | % of in-app notifications read within 1 hour | > 60% |
| Audit log query usage | % of org admins querying audit logs at least once per week | > 70% |

### Reliability Metrics

| KPI | Definition | Target |
|---|---|---|
| API availability | % of successful API responses (non-5xx) | ≥ 99.5% |
| Deployment queue latency | Time from trigger to first status update | < 2 seconds |
| Webhook delivery success rate | % of webhook calls receiving 2xx within 4 attempts | ≥ 98% |
| Notification delivery latency | Time from event to in-app notification display | < 500ms |

### Security Metrics

| KPI | Definition | Target |
|---|---|---|
| Secrets encrypted at rest | % of secrets using AES-256-GCM | 100% |
| Audit log coverage | % of state-changing API calls with a corresponding audit log entry | 100% |
| Refresh token replay detection | % of replayed tokens detected and invalidated | 100% |
| API key hash coverage | % of API keys stored as SHA-256 hash (no plaintext) | 100% |

### Portfolio / Quality Metrics

| KPI | Definition | Target |
|---|---|---|
| Test coverage | Backend service layer line coverage | ≥ 80% |
| TypeScript strict compliance | Build errors from `tsc --strict` | 0 |
| OpenAPI coverage | % of endpoints with full request/response schema | 100% |

---

## 9. Dependencies & Assumptions

### 9.1 External Dependencies

| Dependency | Purpose | Version Constraint | Fallback |
|---|---|---|---|
| **MongoDB Atlas / Docker mongo** | Primary data store | mongo ≥ 7.0 | Local Docker Compose |
| **Redis** | BullMQ queue backend + Socket.IO adapter | redis ≥ 7.0 | Local Docker Compose |
| **BullMQ** | Job queue for deployments, webhooks, emails | ≥ 5.x | N/A — required |
| **Socket.IO** | Real-time push notifications | ≥ 4.x | Polling fallback |
| **SMTP / SendGrid** | Email delivery | Any SMTP-compliant | Queue retry handles transient |
| **Docker / Docker Compose** | Development and production containerization | Docker ≥ 24.x | N/A |
| **Node.js** | Runtime | ≥ 20 LTS | N/A |

### 9.2 Internal Dependencies

| Dependency | Blocks |
|---|---|
| Auth module (JWT + RBAC) | All protected endpoints |
| Organization model | Projects, members, audit logs |
| Project + Environment model | Secrets, deployments, webhooks |
| BullMQ workers running | Deployment pipeline, webhook delivery, email |
| Redis available | BullMQ, Socket.IO real-time |

### 9.3 Assumptions

1. **Single-region deployment** — No cross-region replication or failover is required for v1.0
2. **Trusted network** — MongoDB and Redis are accessible only within the Docker network; no external exposure
3. **English-only UI** — No i18n requirement in v1.0
4. **Synchronous audit writes** — Audit log writes are assumed to be fast enough (< 5ms) to be included synchronously in the request/response cycle
5. **BullMQ worker availability** — Workers are assumed to always be running; no graceful degradation path if workers are down (monitoring alerts instead)
6. **Email delivery is non-critical** — Email failure does not cascade to a primary operation failure; in-app notification is the primary channel
7. **SELADEV manages its own secrets** — No external secret provider integration is assumed; the encrypted store is the single source of truth
8. **Demo/portfolio context** — The deployment pipeline is simulated (no actual container builds); the system demonstrates the patterns of a real pipeline without requiring cloud infrastructure

---

*Document version: 1.0.0 — Last updated: June 2026*
*Author: SELADEV Engineering*
*Cross-references: [00-project-overview.md](./00-project-overview.md) · [02-requirements.md](./02-requirements.md) · [auth-design.md](./auth-design.md) · [system-design.md](./system-design.md)*
