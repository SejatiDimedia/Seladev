# Audit Logs Module

**Document Type:** Feature Module Design — Compliance Critical  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the Audit Logs module for SELADEV — the immutable compliance trail that records every significant operation performed on the platform. Audit logs provide the answer to "who did what, when, and to which resource" — essential for security incident investigation, compliance auditing, and operational accountability.

---

## Context

Enterprise software requires auditability. Engineering teams operating SELADEV need to answer questions like:

- "Who revealed the production database secret at 2am?"
- "Which team member modified the webhook configuration before the outage?"
- "When was this API key created, and has it been used?"
- "Who approved the deployment to production on Friday?"

Audit logs must be:
- **Immutable** — no actor (including admins) can modify or delete log entries
- **Complete** — every mutating operation is captured, including failed privileged operations
- **Queryable** — filtering by actor, resource, action, and time range must be fast
- **Tamper-evident** — any modification to a log entry must be detectable

---

## Audit Log Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  actor: {
    userId: ObjectId | null,  // null for system/API key events
    email: string,            // Denormalized — stored directly, not referenced
    ipAddress: string,
    userAgent: string,
  },
  action: AuditAction,        // Dot-notation string (e.g., 'secret.revealed')
  resource: {
    type: string,             // 'secret' | 'project' | 'deployment' | ...
    id: string,               // Resource ObjectId as string
    name: string,             // Denormalized display name — e.g., 'DATABASE_URL'
  },
  metadata: Record<string, unknown>,  // Action-specific context (never plaintext secrets)
  outcome: 'success' | 'failure',
  createdAt: Date,            // Indexed descending. Never updated.
}
```

### Denormalization by Design

`actor.email` and `resource.name` are **stored directly** in the audit log document rather than as references to the `users` or resource collections. This is an intentional denormalization:

- **Reference integrity is the wrong model for audit logs.** If a user is deleted, their audit history must still show their email. If a secret is renamed, historical logs must show the name at time of action.
- **Audit queries are append-only reads.** The query `"show me all actions by alice@example.com"` must work even after Alice's account is deleted.
- **Query performance.** Denormalized data avoids joins that would be required on every audit log query.

---

## Immutability Enforcement

Immutability is enforced at three independent layers:

### Layer 1: Repository — No Update/Delete Methods

The `AuditLogRepository` exposes only `create` and `findMany`. No `update`, `updateOne`, `delete`, or `deleteOne` methods exist:

```typescript
// features/audit-logs/audit-log.repository.ts
class AuditLogRepository {
  async create(entry: CreateAuditLogDto): Promise<AuditLog> {
    return AuditLogModel.create(entry);
  }

  async findMany(filter: AuditLogFilter): Promise<PaginatedResult<AuditLog>> {
    // cursor pagination, no modification
  }

  // No update(), delete(), updateMany(), deleteMany() methods
}
```

If a developer accidentally calls a non-existent method, TypeScript produces a compile error. If they attempt to reach the Mongoose model directly (bypassing the repository), architecture linting catches this.

### Layer 2: MongoDB Write Concern

All audit log inserts use `{ writeConcern: { w: 'majority', j: true } }` — data is only acknowledged after being written to the majority of replica set members and flushed to the journal. This ensures no audit entry is silently lost during a failover.

### Layer 3: Error on Attempted Modification

The service layer throws `OperationNotPermittedError` if modification is attempted:

```typescript
class AuditLogService {
  // This method does not exist — intentionally omitted
  // async update(): never { throw new OperationNotPermittedError('...'); }
}
```

---

## Action Taxonomy

All audit actions follow dot-notation: `<module>.<action>`.

### Authentication

| Action | Description |
|---|---|
| `auth.login` | Successful login |
| `auth.login_failed` | Failed login attempt (wrong password) |
| `auth.logout` | Explicit logout |
| `auth.token_refreshed` | Refresh token used to issue new access token |
| `auth.password_changed` | Password updated |
| `auth.token_revoked` | Refresh token explicitly revoked |

### Organization

| Action | Description |
|---|---|
| `org.created` | Organization created |
| `org.updated` | Organization settings/name changed |
| `org.archived` | Organization soft-deleted |
| `org.ownership_transferred` | Ownership transferred to another member |

### Members

| Action | Description |
|---|---|
| `member.invited` | Invitation sent |
| `member.joined` | Invitation accepted |
| `member.removed` | Member removed from org |
| `member.role_changed` | Role updated |
| `member.suspended` | Member suspended |
| `member.force_logged_out` | Admin force-logout |

### Projects

| Action | Description |
|---|---|
| `project.created` | Project created |
| `project.updated` | Project settings changed |
| `project.archived` | Project archived |
| `project.member_added` | Member added to project |
| `project.member_removed` | Member removed from project |

### Secrets

| Action | Description |
|---|---|
| `secret.created` | Secret created (name only in metadata) |
| `secret.updated` | Secret value updated |
| `secret.deleted` | Secret deleted |
| `secret.revealed` | Secret plaintext value decrypted and returned |

### API Keys

| Action | Description |
|---|---|
| `apiKey.created` | API key created (prefix + scopes in metadata) |
| `apiKey.revoked` | API key deactivated |
| `apiKey.expired` | API key used after expiry |

### Deployments

| Action | Description |
|---|---|
| `deployment.triggered` | Deployment initiated |
| `deployment.approved` | Deployment approved |
| `deployment.rejected` | Deployment rejected |
| `deployment.cancelled` | Deployment cancelled |
| `deployment.completed` | Deployment succeeded |
| `deployment.failed` | Deployment failed |

### Webhooks

| Action | Description |
|---|---|
| `webhook.created` | Webhook endpoint created |
| `webhook.updated` | Webhook updated |
| `webhook.deleted` | Webhook deleted |
| `webhook.secret_rotated` | Webhook signing secret rotated |
| `webhook.delivery_failed` | Webhook delivery exceeded max retries |
| `webhook.disabled` | Webhook auto-disabled after failure streak |

---

## Fire-and-Forget Pattern

`AuditLogService.record()` is **not awaited** at call sites:

```typescript
// features/secrets/secrets.service.ts
async revealSecret(secretId: string, actor: ActorContext): Promise<string> {
  const secret = await this.secretRepo.findById(secretId, actor.orgId);
  const plaintext = this.cryptoService.decrypt(secret);

  // Non-blocking audit log — does NOT delay the response
  this.auditLogService.record({
    action: 'secret.revealed',
    actor,
    resource: { type: 'secret', id: secretId, name: secret.name },
    outcome: 'success',
  }).catch(err => logger.error('Audit log failed', { err, action: 'secret.revealed' }));

  return plaintext;
}
```

**Rationale:** Adding audit log latency to every mutating operation would degrade user-facing response times. The audit log write is non-critical to the operation's success — a MongoDB write failure should not cause the user's action to fail.

**Tradeoff:** In a catastrophic MongoDB failure, a small window of actions may go unlogged. For a portfolio project, this is acceptable. In a SOC2-compliant system, audit logs would be written synchronously or to a separate, more durable store (e.g., AWS CloudTrail, an append-only Kafka topic).

---

## Querying Audit Logs

### Filters

```typescript
interface AuditLogFilter {
  organizationId: string;       // Always required — tenant scoped
  actorId?: string;
  actorEmail?: string;
  action?: string | string[];   // Single action or array
  resourceType?: string;
  resourceId?: string;
  outcome?: 'success' | 'failure';
  startDate?: Date;
  endDate?: Date;
  cursor?: string;              // Opaque cursor for pagination
  limit?: number;               // Max 100
}
```

### Cursor Pagination for Audit Logs

Audit logs are append-only, making cursor pagination ideal. The cursor encodes the `_id` of the last seen document:

```typescript
// Cursor: base64(JSON.stringify({ id: lastId, ts: lastTimestamp }))
const cursor = Buffer.from(JSON.stringify({ id: lastDoc._id, ts: lastDoc.createdAt })).toString('base64');

// Next page query
const { id, ts } = JSON.parse(Buffer.from(cursor, 'base64').toString());
const nextPage = await AuditLogModel.find({
  organizationId,
  ...filter,
  $or: [
    { createdAt: { $lt: new Date(ts) } },
    { createdAt: new Date(ts), _id: { $lt: new ObjectId(id) } },
  ],
}).sort({ createdAt: -1, _id: -1 }).limit(limit);
```

This prevents phantom records even if new audit entries are written while the user is paginating.

### Index Strategy

```javascript
// Compound index for all common filter patterns
{ organizationId: 1, createdAt: -1 }      // Required on every query
{ organizationId: 1, action: 1, createdAt: -1 }
{ organizationId: 1, 'actor.userId': 1, createdAt: -1 }
{ organizationId: 1, 'resource.id': 1, createdAt: -1 }
```

All indexes include `organizationId` as the leading key to support the mandatory tenant-scoped query pattern.

---

## Role Restriction

Only `owner` and `admin` org roles can access audit logs:

```typescript
router.get('/audit-logs', authenticate, authorizeRBAC('audit-logs', 'read'), handler);

// authorizeRBAC checks:
// - org role: 'owner' or 'admin' only
// - project-level access is insufficient for audit logs
```

`member` and `viewer` roles see a 403 response if they attempt to access audit logs. The audit log itself records the failed access attempt.

---

## Retention Policy

| Plan | Retention Period |
|---|---|
| Free | 30 days |
| Pro | 90 days |
| Enterprise | 365 days |

Retention is enforced by a BullMQ scheduled job that runs daily:

```typescript
// Deletes audit logs older than retention period for each org
// Runs at 02:00 UTC to minimize user-facing impact
await AuditLogModel.deleteMany({
  organizationId,
  createdAt: { $lt: retentionCutoff },
});
```

**Note:** Retention-based deletion is the one exception to the immutability principle — expired records are deleted as per plan terms, not by any user.

---

## API Endpoints

```
GET /api/v1/organizations/:slug/audit-logs
  Query: ?action=secret.revealed&actorId=...&startDate=...&endDate=...&cursor=...&limit=20
  Auth: org:admin or org:owner only
  Returns: paginated list with next cursor
```

---

## Decisions

### Denormalization (actor.email, resource.name)
**Decision:** Store email and resource names directly rather than as references.  
**Rationale:** Reference integrity is incompatible with historical accuracy. Audit logs must be read correctly even after referenced documents are deleted or renamed. See Context section above.

### Fire-and-Forget
**Decision:** Audit log writes are not awaited at call sites.  
**Rationale:** Synchronous audit logging adds database write latency to every operation. For a portfolio project, eventual consistency is sufficient. Production systems requiring SOC2 compliance would use synchronous writes or a separate audit log sink.

### No Update/Delete Repository Methods
**Decision:** The repository exposes no mutation methods after `create`.  
**Rationale:** Immutability is a structural guarantee, not a policy. If mutation methods existed, they could be called accidentally. Omitting them from the type system makes corruption structurally impossible.

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Denormalization | Historical accuracy, no joins | Slight data redundancy |
| Fire-and-forget | No added latency to mutations | Small window of potential log loss |
| No delete methods | Immutability guarantee | Cannot fix incorrect log entries (by design) |
| Cursor pagination | No phantom records | Cannot jump to arbitrary page |

---

## Future Improvements

- **Atlas Search integration** — Full-text search across `metadata` and `resource.name` for rich investigation queries.
- **Export to CSV/JSON** — Allow admins to export audit logs for a date range. Useful for compliance audits.
- **Webhook-delivered audit events** — Push audit events to external SIEM systems (Splunk, Datadog) in real-time via webhook.
- **S3/GCS archiving** — Before retention-based deletion, archive logs to cold storage (BSON or JSONL format) for long-term compliance without paying MongoDB storage costs.
- **Cryptographic signing** — Sign each log entry with the platform's private key to provide non-repudiation beyond the database level.
