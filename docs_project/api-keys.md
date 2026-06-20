# API Keys Module

**Document Type:** Feature Module Design — Security Critical  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the API Keys module for SELADEV — the mechanism for machine-to-machine authentication without human user sessions. API keys allow CI/CD pipelines, CLI tools, and external integrations to interact with the SELADEV API programmatically using scoped, long-lived credentials.

---

## Context

Browser-based JWT authentication is unsuitable for automated systems:
- JWTs require a refresh flow that assumes an interactive user
- Service accounts do not have passwords to log in with
- CI/CD pipelines need stable credentials that survive across runs

API keys solve this with a simple, HTTP-header-based authentication model: one static token, scoped to declared permissions, with configurable expiry.

---

## Key Format

```
sdv_sk_6Tz4XqN3mP8Hk2wR9cBvAyJeUfLsDgQi7nEoKp
└──────┘ └──────────────────────────────────────────────┘
 prefix         base58-encoded 32 random bytes
```

**Components:**
- **Prefix `sdv_sk_`** — identifies this as a SELADEV secret key. Enables automatic detection by GitHub Secret Scanning, GitGuardian, and truffleHog if accidentally committed.
- **`base58(32 random bytes)`** — 43 characters of URL-safe entropy (~256 bits). Base58 excludes visually ambiguous characters (0, O, I, l).

**Why this format (GitHub/Stripe/Vercel model):**
- The `sdv_sk_` prefix is registered with secret scanning services for automated commit detection
- Base58 is URL-safe — no encoding needed in headers or URLs
- 256 bits of entropy makes brute-force computationally infeasible
- The prefix allows instant human identification in logs and config files

---

## Storage Model

**Only the SHA-256 hash of the full key is stored.** The plaintext key is never persisted after the creation response.

```typescript
// On creation
const rawKey = `sdv_sk_${base58encode(randomBytes(32))}`;
const keyHash = createHash('sha256').update(rawKey).digest('hex');
const prefix = rawKey.slice(0, 12);  // 'sdv_sk_6Tz4'

await apiKeyRepo.create({
  keyHash,
  prefix,
  // rawKey is NEVER stored
});

// Return rawKey ONCE in the creation response
return { key: rawKey, prefix, id, scopes, ... };
```

**Why SHA-256 (not bcrypt) for API keys:**
- API key lookups happen on **every authenticated request** — bcrypt's deliberate slowness (300ms+) makes it prohibitive at this frequency
- SHA-256 is sufficient for API keys because they are:
  - Long (256-bit entropy) — not susceptible to dictionary attacks
  - Random — not user-chosen passwords that need slow hashing for dictionary attack resistance
  - Already high-entropy — bcrypt's salt/stretch is unnecessary overhead

This is the same model used by GitHub Personal Access Tokens, Stripe API keys, and Vercel tokens.

---

## Key Lifecycle

```
1. CREATE  → Full key returned once. User copies and stores securely.
2. USE     → SHA-256(key) looked up in DB on every request.
3. ROTATE  → User creates new key, updates their system, then revokes old key.
4. REVOKE  → isActive: false. Key rejected on next use.
5. EXPIRE  → expiresAt reached. Key auto-rejected. Notification sent.
```

**There is no key retrieval.** After creation, the API only returns the `prefix` (first 12 chars) for identification. If a key is lost, the user must create a new one and revoke the old one.

---

## Scopes System

API keys carry **explicit permission scopes** using the same `resource:action` format as RBAC:

```typescript
type ApiKeyScope =
  | 'secrets:read'
  | 'secrets:write'
  | 'deployments:read'
  | 'deployments:write'
  | 'deployments:trigger'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'projects:read'
  | 'audit-logs:read'
  | 'members:read'
  | 'api-keys:read';
```

### Scope Enforcement

API key scopes intersect with RBAC — a key cannot grant permissions that its owner doesn't have:

```typescript
// authenticate-api-key.ts middleware
const requiredScope = `${resource}:${action}`;

// 1. Key must have the required scope
if (!apiKey.scopes.includes(requiredScope)) {
  throw new ForbiddenError(`API key missing required scope: ${requiredScope}`);
}

// 2. Key owner must also have that permission (RBAC check)
const membership = await rbacService.getMembership(apiKey.userId, orgId);
if (!rbacService.checkPermission(membership.role, resource, action)) {
  throw new ForbiddenError('Key owner lacks permission for this action');
}
```

This dual-check prevents privilege escalation: even if someone creates a key with `secrets:write` scope, if their org role is `viewer`, the key cannot write secrets.

---

## Org-Scoped vs Project-Scoped Keys

```typescript
{
  organizationId: ObjectId,
  projectId: ObjectId | null,  // null = org-scoped key
  scopes: string[],
}
```

| Key Type | `projectId` | Scope | Use Case |
|---|---|---|---|
| Org-scoped | `null` | Across all projects in org | CI/CD runner managing multiple projects |
| Project-scoped | `<projectId>` | Only within specified project | Deployment pipeline for a single service |

Project-scoped keys are rejected at the RBAC layer if they attempt to access resources outside their declared project.

---

## Rate Limiting

API keys have a separate rate limit bucket from user JWT sessions:

| Tier | Default Limit | Window | Configurable |
|---|---|---|---|
| Standard key | 1,000 req | 1 hour | No (per plan) |
| Pro key | 5,000 req | 1 hour | Per key |
| Enterprise key | Custom | Custom | Yes |

Rate limit state is stored in Redis using the key's `_id` as the bucket identifier:

```
Redis key: ratelimit:apikey:<keyId>:hour:<windowStart>
```

Rate limit headers are returned on every response:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1704070800
```

---

## Authentication Middleware Flow

```typescript
// middleware/authenticate-api-key.ts
export const authenticateApiKey = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer sdv_sk_')) return next(); // Not an API key

  const rawKey = authHeader.slice(7); // Remove 'Bearer '
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  // Single indexed lookup — O(1) via { keyHash: 1 } unique index
  const apiKey = await apiKeyRepo.findByHash(keyHash);

  if (!apiKey) throw new AuthenticationError('API key not found', 'API_KEY_INVALID');
  if (!apiKey.isActive) throw new AuthenticationError('API key revoked', 'API_KEY_INVALID');
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new AuthenticationError('API key expired', 'API_KEY_INVALID');
  }

  // Non-blocking lastUsedAt update
  apiKeyRepo.updateLastUsed(apiKey._id).catch(noop);

  req.apiKey = apiKey;
  req.user = {
    userId: apiKey.userId,
    orgId: apiKey.organizationId,
    isApiKey: true,
    scopes: apiKey.scopes,
  };
  next();
};
```

**`lastUsedAt` update is fire-and-forget** (non-blocking) — updating this on every request in the hot path would add unnecessary write latency. The audit log provides a richer access trail.

---

## Key Metadata

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId | null,
  userId: ObjectId,           // Key owner
  name: string,               // Human-readable label (e.g., "GitHub Actions — Production")
  keyHash: string,            // SHA-256 of full key — never returned in API responses
  prefix: string,             // First 12 chars (e.g., 'sdv_sk_6Tz4') — returned for identification
  scopes: string[],
  lastUsedAt: Date | null,
  expiresAt: Date | null,
  isActive: boolean,
  createdAt: Date,
}
```

The `prefix` in list responses allows users to identify which key is which (e.g., in GitHub Actions secrets, they can see `sdv_sk_6Tz4...` and match it to the key named "GitHub Actions — Production").

---

## Audit Trail

| Event | Trigger |
|---|---|
| `apiKey.created` | Key created — includes name, scopes, expiry (never the key value) |
| `apiKey.revoked` | Key deactivated manually |
| `apiKey.expired` | System detected expired key on use attempt |
| `apiKey.used` | Not logged per-request (too high volume) — lastUsedAt serves this purpose |

---

## Security Considerations

- **Key is never logged** — middleware strips the key from request logs before they're written. `req.headers.authorization` is redacted to `[REDACTED]` in all log outputs.
- **Key is never returned after creation** — subsequent `GET /api-keys/:id` returns only `{ id, name, prefix, scopes, lastUsedAt, expiresAt, isActive }`.
- **Key is never in error messages** — error responses reference only the `prefix` if identification is needed.
- **Constant-time comparison** — SHA-256 hashes are compared with `timingSafeEqual` to prevent timing attacks.

---

## API Endpoints

```
GET    /api/v1/organizations/:slug/api-keys         → List keys (metadata only)
POST   /api/v1/organizations/:slug/api-keys         → Create key (returns full key ONCE)
GET    /api/v1/api-keys/:keyId                      → Get key metadata
PATCH  /api/v1/api-keys/:keyId                      → Update name, scopes, expiry
DELETE /api/v1/api-keys/:keyId                      → Revoke (sets isActive: false)
```

---

## Decisions

### SHA-256 over bcrypt for Key Storage
**Rationale:** API key lookups occur on every authenticated request. bcrypt at 12 rounds adds ~300ms — unacceptable for a per-request auth check. SHA-256 is safe here because the key has 256 bits of randomness, making brute-force attacks computationally infeasible regardless of hash speed.

### No Automatic Key Rotation
**Rationale:** Automatic rotation would invalidate keys that consuming systems haven't been updated to use, causing silent outages in CI/CD pipelines. The correct rotation flow is: create new key → update consuming system → verify → revoke old key. This is always a human-in-the-loop process.

### Display Once, Never Retrieve
**Rationale:** Storing retrievable keys (even encrypted) creates a single point of compromise. If the API were breached, all keys would be exposed. Storing only the hash means a DB breach yields only hashes — useless without the original keys.

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| SHA-256 storage | Fast auth on every request | Faster to crack than bcrypt (mitigated by high entropy) |
| Display-once model | Minimal credential exposure | Users must store key securely at creation |
| No auto-rotation | No silent outages | Rotation is manual, requires human process |
| Scope intersection with RBAC | No privilege escalation via keys | Extra RBAC check on every key-authenticated request |

---

## Future Improvements

- **Environment-scoped keys** — A key that only works against `production` environment resources, even if the org has multiple environments. Schema already supports this with a potential `environmentId` field.
- **Short-lived tokens for workers** — Internal service-to-service communication should use short-lived tokens (SPIFFE/SVID or signed JWTs) rather than long-lived API keys. This reduces the blast radius of internal key compromise.
- **Key usage analytics** — Track which endpoints a key calls most frequently. Useful for identifying over-scoped keys that could be tightened.
- **Webhook-triggered key rotation** — When an external secret manager (Vault, AWS Secrets Manager) rotates a credential, it triggers a webhook that automatically creates a new SELADEV API key and revokes the old one.
