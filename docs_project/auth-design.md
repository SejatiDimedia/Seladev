# Authentication & Authorization Design

**Document Type:** Security Architecture  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the authentication (AuthN) and authorization (AuthZ) architecture for the IDP. It covers the JWT + refresh token strategy, RBAC model, permission enforcement, and the security tradeoffs made at each layer. This document is the canonical reference for any engineer implementing or modifying access control.

---

## Context

The IDP manages sensitive resources — encrypted secrets, API keys, and deployment configurations. The auth system must satisfy:

- **Stateless API authentication** — the API must be horizontally scalable without shared session state.
- **Short-lived access tokens** — compromise of an access token must have a bounded blast radius.
- **Secure token rotation** — refresh tokens must be rotated on use and detect reuse attacks.
- **Granular authorization** — permissions differ by organization role and project role independently.
- **API key support** — machine-to-machine access without a human user session.

---

## Authentication: JWT + Refresh Token

### Token Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Access Token (JWT)                  │
│                                                      │
│  Header:  { alg: "RS256", typ: "JWT" }               │
│                                                      │
│  Payload: {                                          │
│    sub: "userId",                                    │
│    email: "user@example.com",                        │
│    orgId: "activeOrgId",                             │
│    role: "admin",           ← org-level role         │
│    type: "access",                                   │
│    iat: <issued_at>,                                 │
│    exp: <issued_at + 15m>   ← short TTL              │
│  }                                                   │
│                                                      │
│  Signed with RSA private key (asymmetric)            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  Refresh Token                       │
│                                                      │
│  Format: cryptographically random (32 bytes, hex)    │
│  TTL: 30 days                                        │
│  Storage: SHA-256 hash stored in MongoDB             │
│  Transport: HttpOnly, Secure, SameSite=Strict cookie │
└─────────────────────────────────────────────────────┘
```

**Why RS256 (asymmetric) instead of HS256 (symmetric)?**

RS256 allows the API to share its public key with downstream services (future microservices, partner integrations) that need to verify tokens without being able to issue them. HS256 requires sharing the secret, meaning any service that can verify can also forge. This is a forward-looking decision — the IDP will eventually expose tokens that third-party tooling needs to verify.

### Token Lifetimes

| Token | TTL | Rationale |
|---|---|---|
| Access token | 15 minutes | Short enough to bound compromise window; long enough to avoid excessive refresh churn |
| Refresh token | 30 days | Covers typical developer session length; sliding window reset on activity |
| API key | Configurable (none, 30d, 90d, 1y) | Service accounts may need long-lived access |

### Refresh Token Rotation Protocol

```
1. Client presents refresh token at POST /auth/refresh
2. Server computes SHA-256(token) → looks up in refreshTokens collection
3. If token not found or expired → 401 Unauthorized
4. If token is REVOKED:
   ├─ Token reuse attack detected
   ├─ Revoke ALL tokens in same family (logout all devices)
   └─ Return 401 with REUSE_DETECTED error code
5. If token is valid:
   ├─ Mark old token as { isRevoked: true, replacedByHash: SHA-256(newToken) }
   ├─ Issue new access token (15m)
   ├─ Issue new refresh token (30d, same family UUID)
   └─ Return both tokens
```

**Token Family Concept:** Every refresh token belongs to a `family` UUID assigned at initial login. When token B replaces token A in rotation, both share the same family. If a rotated-away token A is ever presented again, the server knows the full rotation chain has been compromised and revokes the entire family — logging out all devices for that session.

### Access Token Blocklist

Access tokens are short-lived (15 min). Maintaining a blocklist for every logout event has a cost, but allowing a 15-minute window after logout is unacceptable for security-sensitive operations (secret access, member removal).

**Strategy:** On logout or forced revocation (password change, admin suspension), the access token's `jti` (JWT ID) is written to Redis with TTL equal to the remaining token lifetime. The `authenticateJWT` middleware checks this blocklist.

```typescript
// Redis key pattern
`token:blocklist:${jti}` → "1" (TTL: remaining seconds until exp)
```

This is a targeted blocklist — only revoked tokens are in Redis, not all tokens. Memory footprint is bounded by the number of active logout events within the 15-minute window.

---

## API Key Authentication

API keys follow a different authentication path optimized for machine-to-machine use:

```typescript
// Request header
Authorization: Bearer idp_sk_<base58_payload>

// Middleware path
authenticateApiKey middleware:
  1. Parse prefix from header value
  2. Compute SHA-256(fullKey)
  3. Lookup { keyHash, isActive: true } in apiKeys collection
  4. Verify key not expired (expiresAt check)
  5. Verify requested scope against key.scopes[]
  6. Attach req.apiKey = { keyDoc, isApiKey: true } to request
```

**Scope enforcement:** API keys carry explicit scopes (`secrets:read`, `deployments:write`, etc.). The RBAC middleware enforces that the key's scopes satisfy the route's required permission. A key with broad org-level access but narrow scopes cannot exceed its declared permissions, even if the owner has admin privileges.

**Rate limiting:** API keys have a separate rate limit bucket from user sessions. Default: 1000 requests/hour per key. Configurable per key.

---

## Authorization: RBAC Model

### Role Hierarchy

The IDP uses a two-tier RBAC system. Users have a role at the **organization level** and optionally a role at the **project level**. Project roles override org roles for that project.

#### Organization Roles

| Role | Description |
|---|---|
| `owner` | Full control. Can delete org, transfer ownership, manage billing |
| `admin` | Manage members, projects, settings. Cannot delete org |
| `member` | Access to assigned projects. Cannot manage org settings |
| `viewer` | Read-only access to org-level resources |

#### Project Roles

| Role | Description |
|---|---|
| `project:admin` | Full control within project. Manage environments, secrets, webhooks |
| `project:developer` | Read/write deployments and non-secret config. Cannot manage secrets in protected environments |
| `project:viewer` | Read-only within project |

**Effective permission:** `max(orgRole, projectRole)` — an `org:admin` always has `project:admin` access regardless of project role assignment.

### Permission Matrix

| Action | owner | admin | member (project:admin) | member (project:developer) | viewer |
|---|---|---|---|---|---|
| Delete organization | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage org members | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create project | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read project | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage secrets (standard env) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Manage secrets (protected env) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Read secrets (masked) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Trigger deployment | ✓ | ✓ | ✓ | ✓ | ✗ |
| Manage webhooks | ✓ | ✓ | ✓ | ✗ | ✗ |
| Read audit logs | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage API keys (own) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Manage API keys (others) | ✓ | ✓ | ✗ | ✗ | ✗ |

### Permission Strings

Permissions are expressed as `resource:action` strings:

```
organizations:read    organizations:write   organizations:delete
members:read         members:write         members:delete
projects:read        projects:write        projects:delete
environments:read    environments:write
secrets:read         secrets:write         secrets:delete
deployments:read     deployments:write     deployments:trigger
webhooks:read        webhooks:write
apiKeys:read         apiKeys:write         apiKeys:delete
auditLogs:read
```

### RBAC Enforcement Middleware

```typescript
// Route definition
router.delete(
  '/projects/:projectId',
  authenticateJWT,
  authorizeRBAC({ resource: 'projects', action: 'delete', scope: 'project' }),
  projectController.delete
);

// authorizeRBAC implementation
export const authorizeRBAC = (requirement: PermissionRequirement) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { userId, orgId } = req.user;
    const { projectId } = req.params;

    // 1. Get org membership (cached in Redis, TTL 5 min)
    const membership = await rbacService.getMembership(userId, orgId);
    if (!membership || membership.status !== 'active') {
      return next(new ForbiddenError('Not an active member of this organization'));
    }

    // 2. For project-scoped actions, check project membership
    let effectiveRole = membership.role;
    if (requirement.scope === 'project' && projectId) {
      const projectMembership = await rbacService.getProjectMembership(userId, projectId);
      effectiveRole = rbacService.resolveEffectiveRole(membership.role, projectMembership?.role);
    }

    // 3. Check permission
    const hasPermission = rbacService.checkPermission(
      effectiveRole,
      requirement.resource,
      requirement.action
    );

    if (!hasPermission) {
      return next(new ForbiddenError(`Insufficient permissions: ${requirement.resource}:${requirement.action}`));
    }

    req.effectiveRole = effectiveRole;
    next();
  };
};
```

### RBAC Caching Strategy

RBAC checks happen on every request. Without caching, this means 1-2 MongoDB lookups per request for membership and project membership. Under load, this creates unnecessary database pressure.

**Strategy:** Membership documents are cached in Redis with a 5-minute TTL.

```
Redis key: `rbac:membership:${userId}:${orgId}` → serialized membership
Redis key: `rbac:project:${userId}:${projectId}` → serialized project membership
```

**Cache invalidation:** When a membership is modified (role change, suspension), the cache key is explicitly deleted. This means the stale window is at most 5 minutes for cases where the invalidation call fails — acceptable for this threat model. An alternative is event-driven invalidation via Redis pub/sub, which we may implement if role changes need immediate effect.

---

## Security Hardening

### Password Policy
- Minimum 12 characters
- Checked against HaveIBeenPwned API (k-anonymity model — only first 5 chars of SHA-1 hash sent)
- bcrypt with 12 rounds (≈300ms on reference hardware — tunable via env)
- Rate limited: 5 failed attempts triggers 15-minute lockout

### Token Transport
- Access tokens: `Authorization: Bearer` header only. Never in cookies (CSRF risk with API-first design).
- Refresh tokens: `HttpOnly; Secure; SameSite=Strict` cookie. Never readable by JavaScript.
- API keys: `Authorization: Bearer` header.

### Audit Trail
Every auth event is recorded to the `auditLogs` collection:
- Login success / failure
- Token refresh
- Password change
- API key creation / revocation
- Permission denied events

### Session Management
- Users can view all active sessions (refresh token family list) at `GET /auth/sessions`
- Users can revoke individual sessions or all sessions
- Admin can force-logout any user (revokes all token families)

---

## Future Improvements

- **TOTP / WebAuthn MFA** — MFA fields are already in the schema. Implementation is deferred to avoid scope creep, not by oversight.
- **SAML / OIDC SSO** — `allowedDomains` in org settings is reserved for future SSO enforcement.
- **Fine-grained API key scopes** — Currently scopes are resource-level. Future: environment-scoped keys (key only valid for `production` environment).
- **Short-lived certificates for workers** — Replace long-lived API keys for internal service communication with SPIFFE/SVID certificates.
- **Attribute-based access control (ABAC)** — If the permission matrix grows beyond what role enums can express cleanly, migrate to OPA (Open Policy Agent) for policy evaluation.