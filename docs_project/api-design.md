# API Design

**Document Type:** API Architecture & Conventions  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the REST API design conventions, versioning strategy, request/response contracts, error taxonomy, and pagination patterns for the IDP API. Every engineer implementing or consuming the API must treat this as the authoritative reference. Deviation from these conventions requires an explicit ADR.

---

## Context

The IDP API is consumed by:
1. The React web application (primary consumer)
2. Machine-to-machine clients via API keys (CI/CD pipelines, CLI tools)
3. Third-party integrations via webhooks (event push only, not pull)

The API must be **stable** (no breaking changes without a version bump), **predictable** (consistent error shapes and status codes), and **self-documenting** (OpenAPI spec is generated from code, not maintained manually).

---

## Versioning

All routes are prefixed with a major version:

```
/api/v1/organizations
/api/v1/projects
/api/v1/secrets
```

**Versioning strategy:** URI path versioning (not header-based). Rationale: path versioning is explicit and cache-friendly. Browser and proxy caches can differentiate `/api/v1/` from `/api/v2/` without inspecting headers. Header-based versioning (`Accept: application/vnd.idp.v2+json`) requires every client to handle content negotiation.

**Breaking vs. non-breaking changes:**

| Change Type | Breaking | Version Bump Required |
|---|---|---|
| Add optional response field | No | No |
| Add optional request field | No | No |
| Remove response field | Yes | Yes |
| Rename field | Yes | Yes |
| Change field type | Yes | Yes |
| Change HTTP status code for existing scenario | Yes | Yes |
| Add new endpoint | No | No |
| Change error code string | Yes | Yes |

**Deprecation policy:** Breaking changes in v2 do not immediately remove v1 endpoints. v1 is supported for 6 months post-v2 GA, with deprecation headers on all v1 responses:

```
Deprecation: Sat, 01 Jan 2026 00:00:00 GMT
Sunset: Sat, 01 Jul 2026 00:00:00 GMT
Link: <https://docs.idp.dev/migration/v1-to-v2>; rel="deprecation"
```

---

## URL Design

### Resource Naming

- **Plural nouns** for collections: `/projects`, `/secrets`, `/members`
- **Kebab-case** for multi-word resources: `/api-keys`, `/audit-logs`, `/webhook-deliveries`
- **Nested resources** only when the child cannot exist without the parent, and nesting depth does not exceed 3 levels

```
✓  GET  /api/v1/projects/:projectId/environments
✓  GET  /api/v1/projects/:projectId/environments/:envId/secrets
✗  GET  /api/v1/orgs/:orgId/projects/:projectId/environments/:envId/secrets/:secretId/history
         ↑ Too deep. Flatten: GET /api/v1/secrets/:secretId/history
```

### Route Patterns

```
GET    /resources              → List (paginated)
POST   /resources              → Create
GET    /resources/:id          → Retrieve one
PATCH  /resources/:id          → Partial update
DELETE /resources/:id          → Delete

POST   /resources/:id/actions  → Non-CRUD operations (e.g., /deployments/:id/cancel)
POST   /auth/login             → Auth actions (verbs are acceptable)
POST   /auth/refresh
POST   /auth/logout
```

**Why PATCH instead of PUT?** The IDP API uses PATCH for updates. PUT requires the client to send the full resource representation, which creates a race condition in concurrent edit scenarios and forces clients to first GET the resource before updating one field. PATCH allows partial updates with explicit field selection.

---

## Request Conventions

### Headers

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes (most routes) | `Bearer <token>` or `Bearer <api_key>` |
| `Content-Type` | Yes (POST/PATCH) | `application/json` |
| `X-Org-Id` | No | Override active org context (for users in multiple orgs) |
| `Idempotency-Key` | No | Client-provided UUID for idempotent POST requests |

### Idempotency

POST requests to mutation endpoints accept an `Idempotency-Key` header. If a request with the same key is received within 24 hours, the server returns the cached response from the first successful request without re-executing the operation.

```
POST /api/v1/projects/:projectId/deployments
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

Idempotency records are stored in Redis with a 24-hour TTL. This prevents duplicate deployments from CI/CD retries on network failure.

### Zod Validation

Every request body, query parameter set, and path parameter is validated with a Zod schema before reaching the controller. Validation failures return a structured 400 response with per-field errors. Schema definitions live in `packages/validators/` and are shared between frontend and backend.

---

## Response Conventions

### Success Responses

All success responses use a consistent envelope:

```typescript
// Single resource
{
  "data": { /* resource object */ },
  "meta": {
    "requestId": "req_01HXYZ..."
  }
}

// Collection (paginated)
{
  "data": [ /* resource objects */ ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 142,
    "totalPages": 6,
    "hasNext": true,
    "hasPrev": false
  },
  "meta": {
    "requestId": "req_01HXYZ..."
  }
}

// Action with no body (e.g., DELETE)
// HTTP 204 No Content — no body
```

**Why an envelope?** Bare resource responses (`{ id, name, ... }`) cannot be extended with pagination or metadata without a breaking change. An envelope (`{ data, pagination, meta }`) allows non-breaking additions to the top level. The tradeoff is one extra level of nesting for consumers.

### HTTP Status Codes

| Status | Usage |
|---|---|
| `200 OK` | Successful GET, PATCH |
| `201 Created` | Successful POST that creates a resource |
| `204 No Content` | Successful DELETE |
| `400 Bad Request` | Validation failure, malformed request |
| `401 Unauthorized` | Missing or invalid authentication token |
| `403 Forbidden` | Valid token but insufficient permissions |
| `404 Not Found` | Resource does not exist or not visible to this user |
| `409 Conflict` | Unique constraint violation (duplicate slug, name conflict) |
| `422 Unprocessable Entity` | Valid JSON, valid schema, but business rule violation |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected server error |
| `503 Service Unavailable` | Dependency (DB, Redis) is unavailable |

**404 vs 403:** When a resource exists but the user cannot access it, the API returns **404**, not 403. Returning 403 leaks the existence of the resource to unauthorized callers. The exception is explicit permission denied events on resources the user knows exist (e.g., trying to delete a project they can see but not delete) — those return 403 with a clear error message.

---

## Error Response Contract

All error responses follow a single schema, regardless of status code:

```typescript
{
  "error": {
    "code": "VALIDATION_ERROR",        // Machine-readable error code (stable string)
    "message": "Validation failed",    // Human-readable summary
    "details": [                       // Optional: field-level detail
      {
        "field": "name",
        "message": "Name must be at least 2 characters"
      },
      {
        "field": "slug",
        "message": "Slug already exists in this organization"
      }
    ],
    "requestId": "req_01HXYZ...",      // Correlates to server logs
    "documentationUrl": "https://docs.idp.dev/errors/VALIDATION_ERROR"
  }
}
```

### Error Code Registry

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body or params failed Zod validation |
| `INVALID_TOKEN` | 401 | JWT malformed, expired, or blocklisted |
| `TOKEN_REUSE_DETECTED` | 401 | Refresh token reuse — full session revocation |
| `API_KEY_INVALID` | 401 | API key not found, expired, or revoked |
| `FORBIDDEN` | 403 | Insufficient RBAC permissions |
| `RESOURCE_NOT_FOUND` | 404 | Resource does not exist in this context |
| `CONFLICT` | 409 | Unique constraint violation |
| `BUSINESS_RULE_VIOLATION` | 422 | Valid request, rejected by domain logic |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected error (safe details only, no stack traces) |
| `SERVICE_UNAVAILABLE` | 503 | Dependency outage |

Error codes are **stable strings**. Clients may switch on `error.code` for programmatic handling. The `message` field is for humans and may change between versions without a version bump. The `code` field is under the same breaking change policy as field names.

---

## Pagination

All list endpoints are paginated. Two strategies are used depending on the collection's query pattern:

### Offset Pagination (default)

Used for: projects, members, API keys, webhooks — collections where random-access page navigation is expected.

```
GET /api/v1/projects?page=2&limit=25

Response pagination block:
{
  "page": 2,
  "limit": 25,
  "total": 142,
  "totalPages": 6,
  "hasNext": true,
  "hasPrev": true
}
```

**Limits:** `limit` is capped at 100. Requests for `limit > 100` return a 400.

### Cursor Pagination

Used for: audit logs, deployment history, webhook deliveries — append-only time-series collections where offset pagination suffers from the "phantom record" problem (new records during pagination shift pages).

```
GET /api/v1/audit-logs?limit=50&cursor=<opaque_cursor>

Response:
{
  "data": [...],
  "pagination": {
    "limit": 50,
    "nextCursor": "eyJpZCI6IjY2YWIxMjM0IiwidHMiOjE3MzYwMDAwMDB9",
    "prevCursor": "eyJpZCI6IjY2YWIwMDAwIiwidHMiOjE3MzYwMDAwMDB9",
    "hasNext": true,
    "hasPrev": false
  }
}
```

The cursor is a base64-encoded JSON object containing `{ id, timestamp }`. It is treated as opaque by clients. Decoding it on the client is not a supported contract.

---

## Filtering and Sorting

```
GET /api/v1/deployments
  ?status=failed,cancelled     # Comma-separated enum values
  &environment=production      # Exact match
  &triggeredBy=userId          # Foreign key filter
  &from=2025-01-01             # ISO 8601 date range
  &to=2025-01-31
  &sortBy=createdAt            # Field name
  &sortOrder=desc              # asc | desc
```

**Rules:**
- Only whitelisted fields can be filtered and sorted. Unknown filter params are ignored with a warning header, not rejected.
- Date filters use ISO 8601 format. Invalid dates return 400.
- Sort fields default to `createdAt desc` if not specified.

---

## Rate Limiting

Rate limits are enforced per authentication context:

| Context | Limit | Window |
|---|---|---|
| Unauthenticated | 20 req | 1 minute |
| Authenticated user | 500 req | 1 minute |
| API key (default) | 1000 req | 1 hour |
| API key (custom) | Configurable | Configurable |

Rate limit headers are included on every response:

```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 347
X-RateLimit-Reset: 1704067200
Retry-After: 43          ← Only on 429 responses
```

The sliding window algorithm (Redis sorted set) is used instead of fixed windows to prevent burst exploitation at window boundaries.

---

## Request ID Tracing

Every request is assigned a unique ID:

```typescript
// Generated in request middleware
req.id = `req_${ulid()}`

// Included in all responses
X-Request-Id: req_01HXYZ...

// Included in all log entries
{ requestId: "req_01HXYZ...", userId, orgId, method, path, status, durationMs }
```

ULID (Universally Unique Lexicographically Sortable Identifier) is used instead of UUID because ULIDs are sortable by generation time, which makes log correlation significantly easier.

---

## OpenAPI Specification

The OpenAPI spec (`openapi.yaml`) is **generated from code**, not hand-maintained. Route decorators or explicit registration in the spec generator are the source of truth.

```typescript
// Route-level spec annotation (using tsoa or equivalent)
/**
 * @openapi
 * /api/v1/projects:
 *   get:
 *     summary: List projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Paginated project list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProjectListResponse'
 */
```

The spec is validated in CI (`spectral lint openapi.yaml`) and the Swagger UI is served at `/api/docs` in non-production environments.

---

## Sensitive Field Handling

Certain fields require special treatment in API responses:

| Field | Response Behavior |
|---|---|
| `passwordHash` | Never returned. Omitted at repository projection level. |
| Secret `encryptedValue` | Never returned. Response includes only `name`, `keyVersion`, `updatedAt`. |
| API key full value | Returned once at creation. Subsequent reads return only `prefix` and `name`. |
| Webhook signing secret | Returned once at creation. Subsequent reads return `****` masked value. |
| `mfaSecret` | Never returned. |

This is enforced in the **repository layer** via Mongoose `select` projections, not in the controller. Defense-in-depth: even if a controller bug accidentally returns the full document, the projection ensures the sensitive field is never fetched.

---

## Future Improvements

- **GraphQL endpoint** — A `/graphql` endpoint would allow the frontend to fetch exactly the fields it needs, reducing over-fetching on complex dashboard pages. The REST API remains the primary interface for external consumers.
- **Webhook versioning** — Webhook payloads should carry a `schemaVersion` field to allow consumers to handle multiple payload formats during migrations.
- **Bulk operations** — Add `POST /secrets/batch` for importing/exporting multiple secrets atomically.
- **API changelog** — Automate CHANGELOG generation from OpenAPI diff on every release.