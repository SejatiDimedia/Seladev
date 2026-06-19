# Database Design

**Document Type:** Database Architecture  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the MongoDB schema design for the IDP, covering collection structure, indexing strategy, data modeling decisions, and the tradeoffs made between normalization, query performance, and operational simplicity. Every schema decision is justified with the query patterns it is designed to serve.

---

## Context

MongoDB was chosen as the primary data store (see [`system-design.md`](system-design.md) for the full decision record). The schema design must satisfy:

- **Multi-tenancy** — all documents scoped to an `organizationId`.
- **RBAC** — users have roles at both organization and project scope.
- **Immutable audit trail** — audit log documents must never be modified after creation.
- **Encrypted secret storage** — secret values are stored as ciphertext; schema must carry encryption metadata.
- **Time-series patterns** — deployment history, webhook delivery logs, and audit events are append-only.

---

## Collection Inventory

| Collection | Description |
|---|---|
| `organizations` | Tenant root. All other documents reference this. |
| `users` | Platform users. Auth credentials. |
| `memberships` | User ↔ Organization ↔ Role join. |
| `projects` | Projects within an organization. |
| `projectMembers` | User ↔ Project ↔ Role join. |
| `environments` | Environments within a project (dev, staging, prod). |
| `secrets` | Encrypted secrets scoped to environment. |
| `apiKeys` | Hashed API keys issued to users or service accounts. |
| `deployments` | Deployment records with status state machine. |
| `webhooks` | Webhook endpoint registrations. |
| `webhookDeliveries` | Log of every webhook dispatch attempt. |
| `auditLogs` | Immutable event log for all mutating operations. |
| `notifications` | In-app notification records per user. |
| `refreshTokens` | Hashed refresh token records for rotation tracking. |

---

## Schemas

### `organizations`

```typescript
{
  _id: ObjectId,
  name: string,               // Display name
  slug: string,               // URL-safe unique identifier
  plan: 'free' | 'pro' | 'enterprise',
  settings: {
    mfaRequired: boolean,
    allowedDomains: string[],  // SSO domain restrictions
    maxProjects: number,
    maxMembers: number,
  },
  createdBy: ObjectId,        // ref: users
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
- `{ slug: 1 }` — unique. Used on every org-scoped request to resolve slug → `_id`.

**Decision:** `slug` is immutable after creation. Changing an org slug would break all bookmarked URLs and API client configurations. Expose a `displayName` field for editable names.

---

### `users`

```typescript
{
  _id: ObjectId,
  email: string,
  passwordHash: string,       // bcrypt, 12 rounds
  firstName: string,
  lastName: string,
  avatarUrl: string | null,
  isActive: boolean,
  lastLoginAt: Date | null,
  mfaEnabled: boolean,
  mfaSecret: string | null,   // TOTP secret, encrypted at rest
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
- `{ email: 1 }` — unique. Auth lookup path.
- `{ isActive: 1 }` — filter for active users in admin queries.

**Decision:** `passwordHash` and `mfaSecret` are stored on the user document rather than a separate `credentials` collection. The query pattern is always "get user + credentials together" during authentication, making a join a pure overhead cost with no isolation benefit at this scale.

**Security:** `mfaSecret` is encrypted with the application-level key (AES-256-GCM) before storage. The `passwordHash` field is never included in API response serialization (enforced at the repository layer via field projection).

---

### `memberships`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,  // ref: organizations
  userId: ObjectId,          // ref: users
  role: 'owner' | 'admin' | 'member' | 'viewer',
  invitedBy: ObjectId,       // ref: users
  status: 'active' | 'invited' | 'suspended',
  joinedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
- `{ organizationId: 1, userId: 1 }` — unique compound. Prevents duplicate membership. Used in RBAC middleware to check membership + role in a single query.
- `{ userId: 1 }` — supports "get all orgs for user" (org switcher).

**Decision:** Organization-level roles and project-level roles are stored in separate collections (`memberships` vs `projectMembers`). Merging them into a single `roles` collection with a `scope` field was considered but rejected — the query patterns are completely separate, and separate collections allow independent indexing strategies.

---

### `projects`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  name: string,
  slug: string,               // Unique within org
  description: string,
  visibility: 'private' | 'internal',
  repositoryUrl: string | null,
  tags: string[],
  settings: {
    deploymentProtection: boolean,
    requireApproval: boolean,
    allowedBranches: string[],
  },
  createdBy: ObjectId,
  archivedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
- `{ organizationId: 1, slug: 1 }` — unique compound. Project slugs are unique per org.
- `{ organizationId: 1, archivedAt: 1 }` — supports "list active projects" query (filter `archivedAt: null`).

---

### `environments`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  name: string,               // 'development' | 'staging' | 'production' | custom
  slug: string,
  type: 'development' | 'staging' | 'production',
  isProtected: boolean,       // Protected envs require elevated role for secret access
  variables: {                // Non-sensitive env vars stored in plain text
    key: string,
    value: string,
    isSecret: boolean,        // If true, value is a reference to secrets collection
  }[],
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
- `{ projectId: 1, slug: 1 }` — unique compound.
- `{ projectId: 1, type: 1 }` — query pattern for "get production environment for project".

**Decision:** Non-sensitive environment variables (feature flags, URLs, non-secret config) are embedded in the environment document as an array. This avoids a separate collection for the common case and allows atomic updates to the full env var set. Secret values are **never** embedded — `isSecret: true` marks a reference to the `secrets` collection.

---

### `secrets`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  environmentId: ObjectId,
  name: string,               // The secret key name (e.g., DATABASE_URL)
  encryptedValue: string,     // AES-256-GCM ciphertext, base64 encoded
  iv: string,                 // Initialization vector, base64 encoded
  authTag: string,            // GCM auth tag for integrity verification
  keyVersion: number,         // Encryption key version for rotation support
  createdBy: ObjectId,
  lastAccessedAt: Date | null,
  expiresAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
- `{ environmentId: 1, name: 1 }` — unique compound. One secret per name per environment.
- `{ organizationId: 1, projectId: 1 }` — supports bulk secret operations.
- `{ expiresAt: 1 }` — TTL-style query for expiring secrets (not a MongoDB TTL index — expiry triggers notification, not deletion).

**Encryption Design:**
- Each secret is encrypted with AES-256-GCM using a per-secret IV (random, 12 bytes).
- The encryption key is a derived key: `HMAC-SHA256(masterKey, organizationId)`. This means each organization's secrets use a different derived key without storing per-org keys.
- `keyVersion` enables rolling key rotation without re-encrypting all secrets simultaneously.
- The `authTag` provides integrity verification — any tampering with `encryptedValue` will fail decryption.

**What is NOT stored:** The plaintext value is never persisted, logged, or included in API responses after the initial creation response.

---

### `apiKeys`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId | null,   // null = org-scoped key
  userId: ObjectId,             // Key owner
  name: string,                 // Human-readable label
  keyHash: string,              // SHA-256 of the full key
  prefix: string,               // First 8 chars of key for identification (e.g., 'idp_sk_a1b2')
  scopes: string[],             // ['secrets:read', 'deployments:write', ...]
  lastUsedAt: Date | null,
  expiresAt: Date | null,
  isActive: boolean,
  createdAt: Date,
}
```

**Indexes:**
- `{ keyHash: 1 }` — unique. The primary lookup path for API key authentication.
- `{ organizationId: 1, isActive: 1 }` — list active keys for org.
- `{ userId: 1 }` — list keys by owner.

**Key Format:** `idp_sk_<base58(32 random bytes)>`. The prefix `idp_sk_` enables instant identification in logs and accidental commit scanners (GitHub secret scanning, truffleHog).

**Decision:** Only the SHA-256 hash of the key is stored. The full key is returned once at creation and never retrievable again. This is the same model used by GitHub, Stripe, and Vercel. Storing the hash rather than bcrypt is intentional — API key lookups happen on every authenticated request and bcrypt's cost makes it prohibitive at that frequency. SHA-256 is sufficient for API keys because they are long, random, and not user-chosen passwords.

---

### `deployments`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  environmentId: ObjectId,
  version: string,            // Semantic version or commit SHA
  branch: string,
  commitSha: string,
  commitMessage: string,
  status: 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled',
  statusHistory: {
    status: string,
    timestamp: Date,
    message: string,
  }[],
  triggeredBy: ObjectId,      // ref: users
  triggeredVia: 'ui' | 'api' | 'webhook' | 'schedule',
  buildLogs: string[],        // Simulated build log lines
  duration: number | null,    // Milliseconds
  errorMessage: string | null,
  metadata: Record<string, unknown>,
  createdAt: Date,
  completedAt: Date | null,
}
```

**Indexes:**
- `{ projectId: 1, createdAt: -1 }` — deployment history, newest first.
- `{ environmentId: 1, status: 1 }` — "active deployments in environment" dashboard query.
- `{ organizationId: 1, status: 1, createdAt: -1 }` — org-level deployment activity feed.

**Decision:** `statusHistory` is embedded as an array rather than a separate collection. Deployment status events are tightly coupled to their deployment and never queried independently. Embedding keeps the deployment document self-contained and avoids a join on every status read.

---

### `webhooks`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId | null,
  name: string,
  url: string,
  secretHash: string,         // SHA-256 of the signing secret
  events: string[],           // ['deployment.completed', 'secret.created', ...]
  isActive: boolean,
  headers: Record<string, string>,  // Custom headers to include
  createdBy: ObjectId,
  lastTriggeredAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}
```

---

### `webhookDeliveries`

```typescript
{
  _id: ObjectId,
  webhookId: ObjectId,
  organizationId: ObjectId,
  event: string,
  payload: Record<string, unknown>,
  requestHeaders: Record<string, string>,
  responseStatus: number | null,
  responseBody: string | null,
  responseTimeMs: number | null,
  attempt: number,
  status: 'pending' | 'success' | 'failed',
  errorMessage: string | null,
  deliveredAt: Date | null,
  nextRetryAt: Date | null,
  createdAt: Date,
}
```

**Indexes:**
- `{ webhookId: 1, createdAt: -1 }` — delivery log for a webhook.
- `{ organizationId: 1, status: 1, createdAt: -1 }` — failed deliveries requiring attention.
- `{ nextRetryAt: 1, status: 1 }` — BullMQ recovery scan for pending retries.

**Retention:** Delivery records older than 30 days are pruned by a scheduled BullMQ job. A MongoDB TTL index is not used here because pruning is org-plan-dependent (enterprise orgs retain 90 days).

---

### `auditLogs`

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId | null,
  actor: {
    userId: ObjectId,
    email: string,            // Denormalized — user may be deleted later
    ipAddress: string,
    userAgent: string,
  },
  action: string,             // 'secret.created' | 'member.removed' | ...
  resource: {
    type: string,             // 'secret' | 'project' | 'apiKey' | ...
    id: string,
    name: string,             // Denormalized display name
  },
  metadata: Record<string, unknown>,  // Action-specific details
  status: 'success' | 'failure',
  errorCode: string | null,
  timestamp: Date,
}
```

**Indexes:**
- `{ organizationId: 1, timestamp: -1 }` — primary audit log query (org timeline).
- `{ organizationId: 1, 'actor.userId': 1, timestamp: -1 }` — filter by actor.
- `{ organizationId: 1, 'resource.type': 1, 'resource.id': 1, timestamp: -1 }` — resource history.
- `{ organizationId: 1, action: 1, timestamp: -1 }` — filter by action type.

**Immutability:** The audit log collection has no update or delete operations exposed in the repository. The repository's `update` and `delete` methods throw `OperationNotPermittedError`. MongoDB-level write concern is set to `majority` for all audit log inserts.

**Denormalization Decision:** `actor.email` and `resource.name` are stored on the event. This is intentional — if a user is deleted or a project is renamed, the audit log must still accurately reflect what happened at the time of the event. Referencing `userId` alone would cause broken lookups.

---

### `refreshTokens`

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  tokenHash: string,          // SHA-256 of the refresh token
  family: string,             // UUID for token family (detect reuse attacks)
  isRevoked: boolean,
  replacedByHash: string | null,  // Chain for rotation tracking
  userAgent: string,
  ipAddress: string,
  expiresAt: Date,
  createdAt: Date,
}
```

**Indexes:**
- `{ tokenHash: 1 }` — unique. Primary lookup.
- `{ userId: 1, isRevoked: 1 }` — list active sessions for user.
- `{ expiresAt: 1 }` — TTL index. MongoDB automatically removes expired tokens.

**Token Family Rotation:** When a refresh token is used, the old token is marked `isRevoked: true` and a new token is issued with the same `family` UUID. If an already-revoked token is presented, all tokens in that family are immediately revoked (reuse attack detection). This follows the OAuth 2.0 refresh token rotation best practice.

---

## Indexing Strategy Summary

| Priority | Rule |
|---|---|
| **Required** | All foreign keys used in queries have an index |
| **Required** | All unique constraints use a unique index |
| **Required** | All queries that filter by `organizationId` AND another field use a compound index with `organizationId` first |
| **Required** | Time-series collections (auditLogs, deployments, webhookDeliveries) have `{ ..., timestamp/createdAt: -1 }` compound indexes |
| **Avoid** | Indexes on low-cardinality boolean fields alone (use compound indexes) |
| **Avoid** | More than 6 indexes per collection (write amplification) |

---

## Query Performance Contracts

Critical read paths have explicit performance targets:

| Query | Target P99 | Strategy |
|---|---|---|
| Auth middleware RBAC check | < 5ms | Covered by `{ organizationId, userId }` compound index + Redis cache |
| Audit log page (org, last 50 events) | < 20ms | Covered index on `{ organizationId, timestamp: -1 }` |
| Secret list for environment | < 10ms | Covered index on `{ environmentId, name }` |
| API key lookup (per-request) | < 5ms | Unique index on `{ keyHash }` |
| Deployment history (project) | < 15ms | Compound index on `{ projectId, createdAt: -1 }` |

---

## Future Improvements

- **Secret value versioning** — Store a `history` array of previous ciphertext blobs to enable secret rollback. Currently blocked on storage cost analysis.
- **Audit log archiving** — Move audit events older than 6 months to S3 (BSON export) and support a federated query path.
- **Atlas Search integration** — Add full-text search to audit log and deployment log queries without maintaining a separate Elasticsearch cluster.
- **Schema validation** — Add MongoDB JSON Schema validation at the collection level as a second enforcement layer below Mongoose. Catches any writes that bypass the ORM.