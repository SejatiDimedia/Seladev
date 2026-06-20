# Secrets Module

**Document Type:** Feature Module Design — Security Critical  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the Secrets module for SELADEV — the most security-critical feature on the platform. Secrets manages encrypted storage and controlled access to sensitive credentials (database URLs, API tokens, signing keys) used by development environments. Every decision in this document is made with the assumption that a breach of this module could expose production credentials.

---

## Context

Development teams use secrets to store credentials that must not appear in source code or environment variable files. The Secrets module must satisfy:

- **Encryption at rest** — plaintext values must never be persisted to disk in any form
- **Zero-persistence of plaintext** — once a secret is created, the plaintext value is unrecoverable through the API
- **Access control** — secrets in protected environments require elevated roles
- **Integrity verification** — any tampering with stored ciphertext must be detectable
- **Key rotation** — the encryption key must be rotatable without re-encrypting all secrets simultaneously
- **Audit trail** — every access and mutation must be logged immutably

---

## Secret Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  environmentId: ObjectId,
  name: string,               // The key name (e.g., DATABASE_URL, STRIPE_SECRET_KEY)
  encryptedValue: string,     // AES-256-GCM ciphertext, base64 encoded
  iv: string,                 // Initialization vector, 12 bytes, base64 encoded
  authTag: string,            // GCM authentication tag — detects tampering
  keyVersion: number,         // Encryption key version for rotation support
  createdBy: ObjectId,
  lastAccessedAt: Date | null,// Updated on every decrypt operation
  expiresAt: Date | null,     // Optional expiry — triggers notification, not deletion
  createdAt: Date,
  updatedAt: Date,
}
```

**What is NEVER stored:**
- The plaintext secret value — at any point after encryption
- The plaintext value in application logs
- The plaintext value in error messages
- The plaintext value in audit log `metadata`

See [`database-design.md`](database-design.md) for indexing strategy.

---

## Encryption Design

### Algorithm: AES-256-GCM

AES-256-GCM (Galois/Counter Mode) was chosen over AES-256-CBC because:
- **GCM provides authenticated encryption** — the `authTag` verifies both confidentiality and integrity in one pass. CBC requires a separate HMAC for integrity.
- **Parallelizable** — GCM counter mode allows parallel encryption, CBC does not.
- **Industry standard** — used by TLS 1.3, AWS KMS, Google Cloud KMS for envelope encryption.

### Key Derivation: Per-Organization Derived Keys

Each organization's secrets use a **derived key** rather than a shared master key or a per-secret key:

```typescript
// lib/crypto.ts
function deriveOrgKey(masterKey: Buffer, organizationId: string): Buffer {
  return createHmac('sha256', masterKey)
    .update(organizationId)
    .digest();
}
```

**Why per-org derived keys:**
- If a single secret's key were compromised, only that secret is exposed (ideal but key storage overhead is prohibitive at scale)
- If the master key were used directly, compromising it exposes all secrets from all organizations
- Per-org derived keys provide a middle ground: compromising one org's key (via a side-channel attack) does not expose other organizations

**Key storage:**
- `MASTER_ENCRYPTION_KEY` lives in environment variables (or Vault in production)
- Derived keys are **never stored** — they are computed on demand from master key + orgId
- See [`environment-config.md`](environment-config.md) for key management

### Encryption Flow

```typescript
// lib/crypto.ts
interface EncryptedPayload {
  encryptedValue: string;  // base64
  iv: string;              // base64, 12 bytes
  authTag: string;         // base64, 16 bytes
  keyVersion: number;
}

export function encryptSecret(
  plaintext: string,
  organizationId: string,
  keyVersion: number
): EncryptedPayload {
  const masterKey = Buffer.from(process.env.MASTER_ENCRYPTION_KEY!, 'base64');
  const derivedKey = deriveOrgKey(masterKey, organizationId);

  // 12-byte IV — random per encryption, never reused
  const iv = randomBytes(12);

  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion,
  };
}

export function decryptSecret(
  payload: EncryptedPayload,
  organizationId: string
): string {
  const masterKey = Buffer.from(process.env.MASTER_ENCRYPTION_KEY!, 'base64');
  const derivedKey = deriveOrgKey(masterKey, organizationId);

  const decipher = createDecipheriv(
    'aes-256-gcm',
    derivedKey,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedValue, 'base64')),
    decipher.final(), // Throws if authTag verification fails
  ]);

  return decrypted.toString('utf8');
}
```

### IV Randomness

Each secret encryption uses a **random 12-byte IV** (initialization vector). This guarantees that encrypting the same value twice produces different ciphertext — preventing frequency analysis attacks. The IV is safe to store in plaintext alongside the ciphertext.

### Authentication Tag

The 16-byte GCM `authTag` ensures that any modification to `encryptedValue` (even a single bit flip) causes `decipher.final()` to throw. This makes tampering with stored secrets detectable at decrypt time.

```typescript
// Tampering detection test (from testing-strategy.md)
it('throws on tampered ciphertext', () => {
  const payload = encryptSecret('my-secret', 'org-id');
  const tampered = payload.encryptedValue.slice(0, -4) + 'XXXX';
  expect(() =>
    decryptSecret({ ...payload, encryptedValue: tampered }, 'org-id')
  ).toThrow();
});
```

---

## Secret Lifecycle

### Create

```
POST /api/v1/projects/:projectId/environments/:envId/secrets
Authorization: Bearer <token>
{
  "name": "DATABASE_URL",
  "value": "postgres://user:pass@host:5432/db",
  "expiresAt": "2025-07-01T00:00:00Z"  // optional
}
```

Flow:
1. Zod validation: name format (`^[A-Z][A-Z0-9_]*$`), value non-empty
2. RBAC check: `secrets:write` permission (respects environment protection)
3. Check name uniqueness in environment (409 on conflict)
4. `encryptSecret(value, orgId, currentKeyVersion)` → encrypted payload
5. Repository creates document — plaintext value is not referenced after this point
6. Audit log: `secret.created` (name only, never value)
7. Response: `{ id, name, keyVersion, expiresAt, createdAt }` — **no value field**

### Read (List — Masked)

```
GET /api/v1/projects/:projectId/environments/:envId/secrets
```

Returns secret metadata only — **never the encrypted or plaintext value**:

```json
{
  "data": [
    {
      "id": "64ab...",
      "name": "DATABASE_URL",
      "keyVersion": 1,
      "expiresAt": null,
      "lastAccessedAt": null,
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### Reveal (Decrypt)

Decryption is a **separate explicit endpoint** with additional audit logging:

```
POST /api/v1/secrets/:secretId/reveal
```

- Requires `secrets:read` permission + environment protection check
- Performs decryption
- Updates `lastAccessedAt`
- Records audit log: `secret.revealed` with actor context
- Response: `{ id, name, value: "postgres://..." }` — value included only in this response

This separation makes it explicit in audit logs when a human or service actually read the plaintext value.

### Update (Re-encrypt)

```
PATCH /api/v1/secrets/:secretId
{ "value": "postgres://newhost:5432/db" }
```

- Old encrypted value is overwritten (no version history in MVP)
- New value is encrypted with current `keyVersion`
- Audit log: `secret.updated`
- Response: same as create (no value)

### Delete

```
DELETE /api/v1/secrets/:secretId
```

- Hard delete (secrets cannot be recovered after deletion)
- Audit log: `secret.deleted` with actor context

**Decision:** Secrets are hard-deleted, not soft-deleted. Retaining deleted secrets (even encrypted) is a security liability. If secret versioning is needed, a separate history collection is the right approach (Future Improvements).

---

## Access Control

| Action | Standard Environment | Protected Environment |
|---|---|---|
| List secret names | project:developer+ | project:developer+ |
| Reveal secret value | project:admin+ | project:admin, org:admin, org:owner |
| Create secret | project:admin+ | project:admin, org:admin, org:owner |
| Update secret | project:admin+ | project:admin, org:admin, org:owner |
| Delete secret | project:admin+ | project:admin, org:admin, org:owner |

`project:developer` can see that `DATABASE_URL` exists in production but cannot decrypt or modify it. This allows developers to verify configuration without accessing production credentials.

---

## Secret Expiry

`expiresAt` marks when a secret should be rotated. **It does not trigger automatic deletion.**

When a secret expires:
1. A scheduled BullMQ job scans for secrets where `expiresAt <= now`
2. Creates an in-app notification + email for the secret owner
3. Marks the secret with an `expired` status indicator in the UI
4. Does **not** delete the secret — deletion requires explicit human action

**Decision:** Auto-deletion on expiry would cause silent production outages. The notification-based approach ensures a human reviews the situation before the credential is removed.

---

## Key Rotation Strategy

`keyVersion` enables rolling key rotation without a big-bang re-encryption:

### Rotation Procedure

```
1. Generate new master key: openssl rand -base64 32
2. Set MASTER_ENCRYPTION_KEY_NEW=<new_key> alongside existing MASTER_ENCRYPTION_KEY
3. Increment ENCRYPTION_KEY_VERSION (e.g., 1 → 2)
4. Deploy — new secrets are encrypted with keyVersion=2
5. Run background migration job:
   for each secret where keyVersion < current:
     plaintext = decrypt(secret, oldKey, secret.keyVersion)
     newPayload = encrypt(plaintext, orgId, newKeyVersion)
     update secret document
6. Once all secrets migrated, remove MASTER_ENCRYPTION_KEY (old key)
```

The migration job runs in BullMQ with low concurrency to avoid database pressure. `keyVersion` on each document allows the decryption function to select the correct master key version.

---

## Secret Reference in Environment Variables

Non-secret environment variables in the `environments` collection can reference secrets:

```typescript
variables: [
  { key: 'NODE_ENV', value: 'production', isSecret: false },
  { key: 'DATABASE_URL', value: 'DATABASE_URL', isSecret: true },
  // ^ value is the secret NAME, not the secret value
]
```

When an environment is loaded for deployment, the worker:
1. Loads all non-secret variables directly
2. For `isSecret: true` entries, calls `decryptSecret` to resolve values
3. Injects the full resolved variable set into the deployment context

This keeps the environment document lightweight while maintaining a clean reference to sensitive values.

---

## API Endpoints

```
GET    /api/v1/projects/:projectId/environments/:envId/secrets    → List (masked)
POST   /api/v1/projects/:projectId/environments/:envId/secrets    → Create
GET    /api/v1/secrets/:secretId                                  → Get metadata
PATCH  /api/v1/secrets/:secretId                                  → Update value
DELETE /api/v1/secrets/:secretId                                  → Delete
POST   /api/v1/secrets/:secretId/reveal                          → Decrypt and return value
POST   /api/v1/secrets/batch-import                              → Bulk create (roadmap)
```

---

## Decisions

### AES-256-GCM over AES-256-CBC
GCM provides authenticated encryption (integrity + confidentiality) in a single primitive. CBC requires a separate HMAC, which is error-prone to implement correctly. GCM is the modern standard.

### Per-Org Derived Keys over Shared Master Key
Using the master key directly would mean compromising one environment variable exposes all secrets from all organizations. Per-org derivation provides meaningful isolation without the operational overhead of per-secret key management.

### Hard Delete for Secrets
Soft-deleting secrets retains ciphertext that the organization no longer controls or needs. This is a security liability. Hard deletion is the correct default; versioning is an additive feature when needed.

### Separate Reveal Endpoint
Requiring an explicit `POST /secrets/:id/reveal` call (rather than returning value on `GET`) makes decryption events explicit in audit logs. A bulk `GET /secrets` that returned all values would create a single endpoint capable of exfiltrating an entire environment's credentials with one request.

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Per-org derived keys | Org-level blast radius isolation | Key derivation on every decrypt (microseconds — acceptable) |
| No secret versioning in MVP | Simpler schema, lower storage | Cannot roll back to previous value after update |
| Hard delete | Minimal credential residue | Accidental deletion is unrecoverable |
| Separate reveal endpoint | Explicit audit trail for decryption | Extra API call for legitimate tooling |
| expiresAt as notification, not deletion | No silent outages | Expired secrets still function until manually rotated |

---

## Future Improvements

- **Secret versioning** — Store a history array of previous `{ encryptedValue, iv, authTag, keyVersion, rotatedAt }` entries to enable rollback.
- **HashiCorp Vault / AWS Secrets Manager backend** — Replace envelope encryption with a dedicated secrets backend. The `SecretsEncryption` interface can be swapped out without changing the service or repository layer.
- **Bulk import/export** — `POST /secrets/batch-import` accepting a JSON or `.env` file format. Useful for migrating secrets from other tools.
- **Secret scanning** — Scan new secrets against known-compromised credential patterns (e.g., accidentally pasted JWT with wrong expiry). Alert user if pattern matches a known service's token format.
- **Automatic rotation** — Integration with cloud provider APIs (AWS IAM, GCP IAM) to rotate credentials automatically and update the secret in-place.
