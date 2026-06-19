# Security Design — SELADEV IDP

## Purpose

This document defines the security architecture, threat model, controls, and operational security posture of the SELADEV Internal Developer Platform. It is intended for:

- **Engineering team** — implementing features that touch auth, data access, or external integrations
- **Security reviewers** — auditing the platform before production rollout
- **Operations team** — configuring infrastructure, monitoring for incidents
- **Compliance leads** — mapping controls against SOC2 / ISO 27001 requirements

This document complements:
- `auth-design.md` — JWT/refresh token internals, RBAC model
- `database-design.md` — schema-level encryption, field projection
- `api-design.md` — request validation, error contract
- `monitoring.md` — audit trail, alerting

---

## 1. Security Philosophy

SELADEV adopts three foundational security principles that govern every design decision:

### 1.1 Defense in Depth

No single control is treated as sufficient. Every sensitive operation passes through multiple independent layers:

```
Request → TLS termination
        → CORS policy check
        → Rate limiter
        → JWT verification middleware
        → RBAC enforcement middleware
        → Org scoping in repository
        → Zod input validation
        → Business logic
        → Field projection (never return password hash)
        → Audit log emission
```

A bypass at any single layer does not compromise the system. An attacker who forges a JWT would still be stopped by org-scoped repository queries. An attacker with valid credentials who exhausts rate limits is blocked at the IP layer independently of authentication.

### 1.2 Principle of Least Privilege

Every actor — user, service, API key, or background job — is granted the minimum access required to perform its function:

- **Users** hold the lowest org role that satisfies their work (VIEWER vs ADMIN)
- **API keys** are scoped to a single project and a set of allowed actions
- **Background jobs (BullMQ workers)** receive only the DB connection handle needed for their task
- **MongoDB roles** follow least-privilege: application credentials are never `dbAdmin` or `root`
- **Environment variables** never include secrets that a given service component does not need

### 1.3 Secure by Default

Security must require no opt-in. Insecure configurations must require explicit, documented opt-out:

- JWT verification is enabled for every route; public routes require explicit `@public` annotation
- Org scoping is injected by the base repository class; feature repositories cannot accidentally bypass it
- Rate limiting is applied globally; higher limits require explicit config
- TLS is enforced at the load balancer; HTTP is redirected to HTTPS unconditionally
- Secrets are encrypted before write; there is no plaintext storage path

---

## 2. Threat Model (STRIDE)

The following table maps the STRIDE threat categories to SELADEV's attack surface and the controls in place.

| Threat | Attack Vector | Control |
|--------|--------------|---------|
| **Spoofing** | Forged JWT tokens | RS256 verification with public key; token blocklist in Redis |
| **Spoofing** | Credential stuffing | Rate limiting (5 attempts → 15-min lockout); HaveIBeenPwned check at registration |
| **Spoofing** | Session hijacking via stolen refresh token | Refresh token rotation + reuse detection; `HttpOnly` + `Secure` cookies |
| **Tampering** | Modifying API request payload | Zod schema validation on every endpoint; request body size limits |
| **Tampering** | Manipulating secrets at rest | AES-256-GCM encryption; per-org derived keys; integrity tag verified on decrypt |
| **Tampering** | SQL/NoSQL injection | Mongoose ODM with typed schema; parameterized queries; no raw string interpolation in queries |
| **Repudiation** | Denying a destructive action | Immutable audit log (actor, resource, action, timestamp, IP, userAgent) |
| **Repudiation** | Denying API key usage | API key usage logs with hashed key fingerprint |
| **Info Disclosure** | Leaking resource existence via 403 vs 404 | Unauthorized access to org resources returns 404, not 403 |
| **Info Disclosure** | Secrets in logs | Structured logger explicitly blocks `password`, `secret`, `token`, `key` fields |
| **Info Disclosure** | Cross-tenant data access | All repository queries include mandatory `orgId` filter |
| **Info Disclosure** | Password hash exfiltration | `passwordHash` field is projection-excluded in all repository reads |
| **DoS** | API flooding | Sliding window rate limiting per IP (100 req/min) and per API key (1000 req/min) |
| **DoS** | Large payload attacks | Request body size capped at 100KB (10MB for file uploads) |
| **DoS** | BullMQ job queue flooding | Job concurrency limits, queue depth alerting |
| **Elevation** | Org role escalation | Role assignment requires OWNER privilege; no self-promotion |
| **Elevation** | Cross-project access | Project role checked in middleware before entering project-scoped handlers |
| **Elevation** | API key exceeding its scoped permissions | API key permissions validated against request action at middleware layer |

### 2.1 Trust Boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│  UNTRUSTED ZONE                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │   Browser    │    │  External    │    │  Webhook Consumers   │   │
│  │   (React)    │    │  API Clients │    │  (3rd party systems) │   │
│  └──────┬───────┘    └──────┬───────┘    └──────────┬───────────┘   │
│         │ HTTPS/TLS 1.3     │ HTTPS/TLS 1.3          │ HTTPS        │
└─────────┼───────────────────┼───────────────────────-┼──────────────┘
          │                   │                         │
┌─────────▼───────────────────▼─────────────────────── ▼──────────────┐
│  EDGE / GATEWAY                                                      │
│  Load Balancer → CORS → Rate Limiter → Request Size Limiter         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  APPLICATION ZONE                                                    │
│  Express API → Auth Middleware → RBAC Middleware → Route Handlers   │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────────┐   │
│  │   MongoDB    │   │    Redis     │   │  BullMQ Workers       │   │
│  │  (encrypted) │   │  (blocklist) │   │  (isolated job ctx)   │   │
│  └──────────────┘   └──────────────┘   └───────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Authentication Security

### 3.1 JWT RS256 — Rationale and Configuration

SELADEV uses **RS256 (RSA Signature with SHA-256)** for JWT signing. See `auth-design.md` for full internals.

**Why RS256 over HS256:**

| Property | HS256 | RS256 |
|----------|-------|-------|
| Key type | Shared secret | Public/private key pair |
| Verification | Any party with the shared secret can forge tokens | Verification requires only the public key; forgery requires the private key |
| Key rotation | All consumers need the new secret simultaneously | Consumers update public key; private key never shared |
| Microservice safety | All services are potential attack targets | Workers/services only receive public key |

**Token lifetimes:**

| Token | Lifetime | Storage | Revocation |
|-------|----------|---------|-----------|
| Access token | 15 minutes | Memory (JS variable) | Redis blocklist |
| Refresh token | 7 days | `HttpOnly` cookie | DB revocation flag + family detection |

**Private key management:**
- RSA-2048 key pair generated at deployment time
- `JWT_PRIVATE_KEY` stored as environment secret (never committed)
- `JWT_PUBLIC_KEY` may be exposed at `/.well-known/jwks.json` for service verification
- Key rotation procedure: generate new pair → issue new tokens → old access tokens expire within 15 min → old refresh tokens valid until 7-day expiry then dropped

### 3.2 Refresh Token Rotation and Reuse Detection

Refresh tokens implement a **token family** model to detect theft:

```
Flow (normal):
  Client sends refresh_token_v1
  Server: validates, issues access_token_v2 + refresh_token_v2
  Server: marks refresh_token_v1 as USED (not deleted)

Flow (theft detected):
  Attacker sends refresh_token_v1 (already USED)
  Server: detects reuse → INVALIDATES entire token family
  All sessions for this user's family are revoked
  User must re-authenticate
```

**Implementation details:**
- Each refresh token stores: `userId`, `familyId`, `tokenVersion`, `used: boolean`, `expiresAt`
- `familyId` links all rotated tokens in one session chain
- On logout: marks all tokens in the family as expired
- On `used = true` detection: sets `revokedAt` on the entire family

### 3.3 Access Token Blocklist (Redis)

Access tokens have a 15-minute lifetime, so full token revocation (e.g., on logout or password change) requires a blocklist:

```typescript
// On logout or password change
await redis.set(
  `blocklist:${jti}`,  // jti = JWT ID claim (UUID)
  '1',
  'EX',
  900  // 15 min — matches token lifetime, auto-expires
);

// In auth middleware
const isBlocked = await redis.get(`blocklist:${decoded.jti}`);
if (isBlocked) throw new UnauthorizedError('Token revoked');
```

**Why Redis, not MongoDB:**
- O(1) lookup vs O(log n) indexed DB lookup
- Automatic TTL expiry keeps storage bounded
- No cleanup job needed; TTL matches token lifetime exactly

### 3.4 Password Hashing

Passwords are hashed with **bcrypt at cost factor 12**:

```typescript
// Registration
const hash = await bcrypt.hash(password, 12);

// Verification
const valid = await bcrypt.compare(plaintext, storedHash);
```

**Cost factor 12** — chosen to make each hash operation take ~250ms on a modern server. This is slow enough to make brute-force impractical (4 attempts/sec on a single machine), fast enough to not noticeably affect login UX.

**HaveIBeenPwned integration:**
At registration and password-change time, the candidate password is checked against the HIBP k-Anonymity API:

```typescript
async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const lines = (await response.text()).split('\n');
  return lines.some(line => line.startsWith(suffix));
}
```

The full password hash is **never sent** to HIBP. Only the 5-character SHA-1 prefix is transmitted; the suffix is matched locally. A pwned password returns a 422 with guidance to choose a different password.

### 3.5 Login Rate Limiting and Account Lockout

```
Login attempt → Redis counter: INCR login:{ip}:{email}
                              EXPIRE login:{ip}:{email} 900 (15 min)

If count > 5:
  Return 429 Too Many Requests
  Header: Retry-After: <seconds until window expires>
  Body: { code: "LOGIN_RATE_EXCEEDED", message: "Too many attempts. Try again in 15 minutes." }
```

**Lockout scope:** Per IP + per email combination, not just IP alone. This prevents a single attacker from locking out a victim's account by rotating IPs, while still rate-limiting credential stuffing from a single IP.

**Unlock:** The window is sliding (EXPIRE resets on each attempt). After 15 minutes of no attempts, the counter expires automatically. There is no manual admin unlock required for standard lockout.

---

## 4. Authorization Security

### 4.1 RBAC Enforcement at Multiple Layers

RBAC checks are **not** only in middleware. They occur at three independent layers:

```
Layer 1 — Route Middleware
  requireAuth()        → verifies JWT, attaches req.user
  requireOrgRole('ADMIN') → checks membership.orgRole >= ADMIN

Layer 2 — Service Layer
  secretService.getSecret(userId, orgId, secretId)
    → explicitly verifies caller's org membership before fetching

Layer 3 — Repository Layer
  secretRepository.findById(secretId, { orgId })
    → orgId is mandatory parameter in every repository method signature
    → TypeScript enforces this at compile time
```

This means a bug in middleware (e.g., a route decorator that bypasses `requireOrgRole`) does not open a privilege escalation path, because the service and repository layers enforce the same constraints independently.

### 4.2 404 vs 403 — Resource Existence Leakage Prevention

Returning `403 Forbidden` when a resource exists but is inaccessible leaks information:

> *"The resource exists, you just can't see it."*

SELADEV **always returns 404** when a user requests a resource in an org they do not belong to. This is enforced by the org-scoped query at the repository layer:

```typescript
// Repository always scopes queries by orgId
async findById(id: string, orgId: string): Promise<Secret | null> {
  return Secret.findOne({ _id: id, orgId });
  // Returns null (→ 404) if secret exists in different org
  // Returns null (→ 404) if secret doesn't exist at all
  // The caller cannot distinguish the two cases
}
```

The exception: within the caller's own org, SELADEV **does** return `403` for insufficient project-level permissions (a user can see that a project exists, they just cannot access its secrets). This is consistent with the principle of not leaking cross-org data while providing meaningful errors within a user's authorized scope.

### 4.3 Org Scoping as Mandatory Repository Filter

Every query-issuing repository method has `orgId` as a required parameter enforced at the TypeScript level:

```typescript
// BaseRepository enforces orgId at the type system level
abstract class BaseRepository<T> {
  abstract findById(id: string, orgId: string): Promise<T | null>;
  abstract findAll(orgId: string, filters?: FilterQuery<T>): Promise<T[]>;
}

// Concrete implementation cannot omit orgId — TypeScript error
class SecretRepository extends BaseRepository<Secret> {
  async findById(id: string, orgId: string) {
    return SecretModel.findOne({ _id: id, orgId }); // orgId always injected
  }
}
```

This pattern is intentional: it is **architecturally impossible** to write a repository query that fetches data without an org context. Cross-tenant data leakage requires a deliberate bypass of the type system.

---

## 5. Data at Rest Security

### 5.1 Secret Encryption (AES-256-GCM)

Secrets stored in SELADEV's secret vault are encrypted with AES-256-GCM before write to MongoDB.

**Key derivation:**
```
Master Key (env var: ENCRYPTION_MASTER_KEY, 32-byte random hex)
      │
      ▼ HKDF-SHA256(masterKey, salt=orgId, info="seladev-secret-encryption")
      │
Per-Org Derived Key (32 bytes)
      │
      ▼ AES-256-GCM(derivedKey, iv=random 12 bytes)
      │
Ciphertext + Auth Tag (stored in MongoDB)
```

```typescript
interface EncryptedSecret {
  ciphertext: string;  // Base64
  iv: string;          // Base64, 12 bytes, unique per encryption
  authTag: string;     // Base64, 16 bytes — GCM integrity tag
  keyVersion: number;  // For key rotation tracking
}
```

**Why per-org derived keys, not per-secret keys:**
- See `ADR-008` in `adr.md` for full rationale
- Org key derivation is deterministic from the master key + orgId — no key storage overhead
- Compromise of one org's derived key does not compromise other orgs' secrets
- Master key rotation requires re-encryption of all secrets (planned as admin operation)

**GCM auth tag:** The 16-byte authentication tag means any tampering of the ciphertext is detected on decrypt. There is no separate MAC step needed.

### 5.2 API Key Hashing

API keys are displayed to the user **exactly once** at creation time. SELADEV stores only a SHA-256 hash:

```
Generated key:  seladev_sk_live_<32-byte-random-hex>
Stored in DB:   SHA-256(full key) as hex string
Stored prefix:  first 8 characters (e.g., "seladev_") for UI display
```

```typescript
// On creation
const rawKey = `seladev_sk_${generateSecureRandom(32)}`;
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
await ApiKey.create({ keyHash, prefix: rawKey.slice(0, 12), ... });
return rawKey; // returned ONCE, never stored in plaintext

// On verification
const incomingHash = crypto.createHash('sha256').update(incomingKey).digest('hex');
const key = await ApiKey.findOne({ keyHash: incomingHash });
```

**Why SHA-256 (not bcrypt) for API keys:**
- API keys are high-entropy (256-bit random), not user-chosen — dictionary attacks are infeasible
- bcrypt's 250ms delay would add unacceptable latency to every API request
- SHA-256 lookup is constant-time when compared with `crypto.timingSafeEqual`

### 5.3 Webhook Signing Secret Hashing

Webhook signing secrets (`wh_secret_<random>`) follow the same pattern as API keys: displayed once, stored as SHA-256 hash. The HMAC signature on outbound webhooks is computed from the raw secret held in memory at delivery time (loaded from an encrypted field in the webhook config, not the hash).

### 5.4 MFA Secret Encryption

TOTP secrets (base32-encoded, used to generate 6-digit codes) are encrypted with AES-256-GCM using the user's org-derived key before storage. The plaintext secret is never persisted.

```typescript
// MFA setup
const totpSecret = authenticator.generateSecret(); // e.g., "JBSWY3DPEHPK3PXP"
const encrypted = await encryptionService.encrypt(totpSecret, orgId);
await User.updateOne({ _id: userId }, { mfaSecret: encrypted, mfaEnabled: false });
// Not enabled until first TOTP verification succeeds
```

### 5.5 Password Hash Field Projection

The `passwordHash` field is **never returned by any repository method**:

```typescript
// User repository base projection
const USER_PROJECTION = {
  passwordHash: 0,  // Always excluded
  mfaSecret: 0,     // Always excluded
  __v: 0,
};

async findById(id: string, orgId: string): Promise<User | null> {
  return UserModel.findOne({ _id: id, orgId }, USER_PROJECTION);
}
```

This is enforced at the repository layer, not the route handler layer, so there is no code path that returns a User object with `passwordHash` populated — regardless of which service calls the repository.

---

## 6. Transport Security

### 6.1 HTTPS and TLS 1.3

All traffic to SELADEV is served over HTTPS. TLS 1.3 is the minimum required version:

```nginx
# nginx / load balancer config
ssl_protocols TLSv1.3;
ssl_ciphers   TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256;
ssl_prefer_server_ciphers off;
```

TLS 1.0 and 1.1 are not supported. TLS 1.2 may be supported during a deprecation window if legacy clients require it, with explicit justification logged.

### 6.2 HTTP Strict Transport Security (HSTS)

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

- `max-age=63072000` — 2 years, as recommended for HSTS preload
- `includeSubDomains` — covers `app.seladev.dev`, `api.seladev.dev`
- `preload` — submitted to the HSTS preload list so browsers never attempt HTTP

### 6.3 Secure Cookies

Refresh tokens stored in cookies are set with:

```typescript
res.cookie('refreshToken', token, {
  httpOnly: true,    // Not accessible via document.cookie
  secure: true,      // Only sent over HTTPS
  sameSite: 'strict',// Not sent on cross-site requests (CSRF mitigation)
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth/refresh', // Scoped to refresh endpoint only
});
```

`path: '/api/v1/auth/refresh'` ensures the cookie is only transmitted to the refresh endpoint, not on every API request.

---

## 7. Input Validation

Every API endpoint validates its request payload, query parameters, and path parameters using **Zod schemas**:

```typescript
// Example: Create Secret endpoint
const createSecretSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/),
    value: z.string().min(1).max(65536),
    description: z.string().max(500).optional(),
    environment: z.enum(['development', 'staging', 'production']),
  }),
  params: z.object({
    projectId: z.string().length(24), // MongoDB ObjectId
    orgId: z.string().length(24),
  }),
});

// Middleware factory
function validate(schema: ZodSchema) {
  return (req, res, next) => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!result.success) {
      return res.status(400).json(formatZodError(result.error));
    }
    req.validated = result.data;
    next();
  };
}
```

**Injection prevention:**
- Mongoose ODM uses parameterized queries — no string interpolation into query operators
- Zod string schemas with `.regex()` constraints prevent unexpected characters in identifiers
- JSON body parser with `strict: true` rejects non-object/array top-level values
- `express-mongo-sanitize` strips `$` and `.` from user input as a defense-in-depth measure

---

## 8. CORS Configuration

```typescript
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? [];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  },
  credentials: true,            // Required for cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
  maxAge: 86400,                // Preflight cache: 24 hours
};
```

**Environment variable:** `ALLOWED_ORIGINS=https://app.seladev.dev,https://seladev.dev`

Wildcard (`*`) is never used in production. The CORS policy is explicitly allowlisted.

---

## 9. Rate Limiting Strategy

SELADEV implements rate limiting at two levels: **per-IP** (unauthenticated protection) and **per-API-key** (authenticated client throttling). Both use a **sliding window** algorithm backed by Redis.

### 9.1 Rate Limit Tiers

| Context | Window | Limit | Action on Exceed |
|---------|--------|-------|-----------------|
| Global (per IP) | 1 minute | 100 requests | 429 + `Retry-After` |
| Auth endpoints (per IP+email) | 15 minutes | 5 attempts | 429 + account lockout |
| API key (per key) | 1 minute | 1000 requests | 429 + `X-RateLimit-Limit` header |
| Webhook delivery retries | 1 hour | 10 retries | Dead letter queue |

### 9.2 Sliding Window Implementation

```typescript
async function slidingWindowRateLimit(
  key: string,
  windowSec: number,
  limit: number
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart);    // Remove expired entries
  pipe.zadd(key, now, `${now}-${Math.random()}`); // Add current request
  pipe.zcard(key);                                // Count in window
  pipe.expire(key, windowSec);                    // Reset TTL
  const results = await pipe.exec();

  const count = results[2][1] as number;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
```

### 9.3 Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 43
X-RateLimit-Reset: 1718764800
Retry-After: 47   (only on 429)
```

---

## 10. Audit Trail for Security Events

All security-relevant operations are written to the immutable `audit_logs` collection. See `database-design.md` for schema.

**Security events that always trigger an audit log:**

| Event | Actor | Severity |
|-------|-------|----------|
| `auth.login.success` | User | INFO |
| `auth.login.failure` | Anonymous (IP) | WARN |
| `auth.logout` | User | INFO |
| `auth.token.refresh` | User | DEBUG |
| `auth.password.changed` | User | HIGH |
| `auth.mfa.enabled` | User | HIGH |
| `auth.mfa.disabled` | User | HIGH |
| `org.member.invited` | Admin | HIGH |
| `org.member.removed` | Admin | HIGH |
| `org.role.changed` | Owner | CRITICAL |
| `secret.created` | User | HIGH |
| `secret.read` | User | HIGH |
| `secret.updated` | User | HIGH |
| `secret.deleted` | User | HIGH |
| `apikey.created` | User | HIGH |
| `apikey.rotated` | User | HIGH |
| `apikey.deleted` | User | HIGH |
| `webhook.created` | User | MEDIUM |
| `webhook.deleted` | User | MEDIUM |
| `project.deleted` | Admin | CRITICAL |

**Audit log immutability:** The `audit_logs` collection uses a MongoDB user with `insert`-only permissions. The application service account cannot `update` or `delete` audit log documents. Deletion requires a separate admin credential not available to the API process.

---

## 11. Webhook Security

### 11.1 HMAC Payload Signing

Every outbound webhook request is signed with HMAC-SHA256:

```typescript
function signWebhookPayload(payload: string, secret: string): string {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// Header sent with every delivery:
// X-SELADEV-Signature: sha256=<hex>
// X-SELADEV-Delivery: <uuid>
// X-SELADEV-Timestamp: <unix epoch>
```

Consumers verify the signature before processing:

```typescript
const expectedSig = signWebhookPayload(rawBody, webhookSecret);
const receivedSig = req.headers['x-seladev-signature'];
if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig))) {
  return res.status(401).end();
}
```

**Timestamp validation:** Consumers should reject deliveries where `X-SELADEV-Timestamp` is more than 5 minutes in the past to prevent replay attacks.

### 11.2 SSRF Prevention

Webhook destinations are validated before saving and before delivery:

```typescript
const BLOCKED_CIDRS = [
  '10.0.0.0/8',     // RFC1918 private
  '172.16.0.0/12',  // RFC1918 private
  '192.168.0.0/16', // RFC1918 private
  '127.0.0.0/8',    // Loopback
  '169.254.0.0/16', // Link-local (AWS metadata)
  '::1/128',        // IPv6 loopback
  'fc00::/7',       // IPv6 ULA
];

async function validateWebhookUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new ValidationError('Webhook URL must use HTTP or HTTPS');
  }
  const resolved = await dns.resolve4(parsed.hostname);
  for (const ip of resolved) {
    if (isInBlockedCidr(ip, BLOCKED_CIDRS)) {
      throw new ValidationError('Webhook URL resolves to a private/blocked IP address');
    }
  }
}
```

**DNS rebinding protection:** The SSRF check resolves DNS at validation time and again at delivery time. If the IPs differ (possible DNS rebinding), the delivery is rejected.

---

## 12. Dependency Security

### 12.1 npm Audit in CI

Every CI run executes `npm audit --audit-level=high`. A HIGH or CRITICAL vulnerability in any dependency fails the build:

```yaml
# .github/workflows/ci.yml
- name: Security audit
  run: pnpm audit --audit-level=high
```

MODERATE vulnerabilities generate a warning but do not fail the build. They must be addressed within 30 days.

### 12.2 Dependabot

Dependabot is configured to submit weekly PRs for all dependency updates:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      production-deps:
        dependency-type: production
      dev-deps:
        dependency-type: development
```

Dependabot PRs are reviewed by the security-on-call engineer within 48 hours. Critical CVE patches are fast-tracked and merged within 24 hours.

### 12.3 Lock File Integrity

`pnpm-lock.yaml` is committed to the repository. CI fails if the lock file is not up to date with `package.json`. This prevents supply chain attacks via tampered registry packages.

---

## 13. Secret Scanning

### 13.1 GitHub Secret Scanning

GitHub's native secret scanning is enabled on the repository. It detects patterns matching known secret formats (AWS keys, GitHub tokens, generic high-entropy strings) in commits and PRs. Detected secrets trigger an immediate alert and force the committer to rotate the exposed credential.

### 13.2 Pre-commit Hooks (truffleHog / gitleaks)

A pre-commit hook using **gitleaks** scans staged changes for secrets before they are committed:

```toml
# .gitleaks.toml
[allowlist]
  regexes = [
    '''SELADEV_TEST_''', # Test fixture keys are explicitly allowed
  ]

[[rules]]
  id = "seladev-api-key"
  description = "SELADEV API Key"
  regex = '''seladev_sk_(live|test)_[a-f0-9]{64}'''
  tags = ["key", "seladev"]
```

Developers install the hook via `pnpm prepare` which runs `husky install`. The hook runs automatically and blocks commits containing detected secrets.

### 13.3 Environment Variable Validation at Startup

At server startup, SELADEV validates that all required secrets are present and meet minimum entropy requirements:

```typescript
function validateEnvSecrets(): void {
  const required = ['JWT_PRIVATE_KEY', 'ENCRYPTION_MASTER_KEY', 'MONGODB_URI', 'REDIS_URL'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required secret: ${key}`);
  }
  if (Buffer.from(process.env.ENCRYPTION_MASTER_KEY!, 'hex').length !== 32) {
    throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex chars)');
  }
}
```

The server refuses to start with misconfigured secrets.

---

## 14. OWASP Top 10 Coverage

| OWASP 2021 Category | SELADEV Control |
|---------------------|----------------|
| **A01 — Broken Access Control** | RBAC at 3 layers; org scoping in all queries; 404 masking for cross-tenant resources |
| **A02 — Cryptographic Failures** | AES-256-GCM for secrets; bcrypt for passwords; SHA-256 for API keys; RS256 JWTs; TLS 1.3 |
| **A03 — Injection** | Zod validation on all inputs; Mongoose ODM (no raw query strings); `express-mongo-sanitize` |
| **A04 — Insecure Design** | Threat model documented; security review required for new features; ADR process for architecture decisions |
| **A05 — Security Misconfiguration** | Startup secret validation; CORS allowlist; no default credentials; Docker non-root user |
| **A06 — Vulnerable Components** | `pnpm audit` in CI; Dependabot weekly PRs; lock file integrity check |
| **A07 — Auth Failures** | Rate limiting + lockout; refresh token rotation + reuse detection; access token blocklist |
| **A08 — Software Integrity** | Lock file committed; Dependabot signs PRs; gitleaks pre-commit hook |
| **A09 — Logging Failures** | Structured audit logs; security events always logged; log retention policy (90 days hot, 1 year cold) |
| **A10 — SSRF** | Webhook URL SSRF validation; DNS rebinding detection; private CIDR blocklist |

---

## 15. Incident Response Outline

### 15.1 Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| P0 — Critical | Active breach, data exfiltration in progress | Immediate (< 15 min) | DB exposed to internet, active credential theft |
| P1 — High | Suspected breach, exploitable vulnerability | < 2 hours | Reported RCE, leaked production secret |
| P2 — Medium | Security degradation, elevated risk | < 24 hours | Expired TLS cert, failed audit check |
| P3 — Low | Potential vulnerability, no active risk | < 1 week | MODERATE npm audit finding |

### 15.2 Response Playbook (P0/P1)

```
1. DETECT
   - Alert fires (monitoring.md § Alerting Thresholds)
   - Or: security report from researcher / user

2. CONTAIN
   - Rotate compromised credentials immediately
   - If user accounts: force logout all sessions (invalidate all refresh token families)
   - If DB credentials: rotate and redeploy
   - If API keys: revoke by keyHash scan and notify affected org owners

3. INVESTIGATE
   - Pull audit logs for affected resources (last 7 days minimum)
   - Identify blast radius: which orgs, users, secrets were accessible
   - Preserve logs before any cleanup

4. NOTIFY
   - Internal: Engineering lead, CTO within 30 min of P0/P1 confirm
   - External: Affected org owners within 72 hours (GDPR requirement)
   - If PII involved: DPA notification within 72 hours

5. REMEDIATE
   - Deploy fix
   - Re-encrypt affected secrets if encryption key compromised
   - Issue post-mortem within 5 business days

6. POST-MORTEM
   - Root cause analysis
   - Timeline of events
   - Control failures identified
   - Action items with owners and deadlines
```

### 15.3 Security Contact

Security vulnerabilities should be reported to: `security@seladev.dev`

A responsible disclosure policy and PGP key are published at `https://seladev.dev/.well-known/security.txt`.

---

## 16. Future Improvements

| Item | Priority | Rationale |
|------|----------|-----------|
| **WAF (Web Application Firewall)** | High | Cloudflare WAF or AWS WAF for L7 attack filtering, bot protection, geo-blocking |
| **Penetration Testing** | High | Annual third-party pentest; schedule before GA launch |
| **SOC2 Type II Readiness** | High | Map controls to SOC2 trust service criteria; begin evidence collection |
| **MFA enforcement** | High | Org-level setting to require TOTP for all members (blocks without MFA) |
| **Hardware Security Module (HSM)** | Medium | Move `ENCRYPTION_MASTER_KEY` to AWS KMS or HashiCorp Vault |
| **mTLS between services** | Medium | Mutual TLS for internal service-to-service calls when microservices are extracted |
| **SBOM generation** | Medium | Software Bill of Materials generated in CI for supply chain transparency |
| **Zero-trust network policy** | Low | Network-level segmentation between DB, Redis, and API tiers |
| **Security training program** | Medium | Quarterly security training for all engineers |
| **Bug bounty program** | Low | Public bug bounty after SOC2 Type II certification |

---

*Document version: 1.0 | Last updated: 2026-06-19 | Owner: Platform Security Team*
