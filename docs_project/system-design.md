# System Design

**Document Type:** Architecture Decision Record (ADR) + System Design  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the system architecture for the Internal Developer Platform (IDP). It covers component boundaries, data flow, integration points, and the technical reasoning behind every major structural decision. This is the authoritative reference for understanding how the system is composed and how its parts communicate.

---

## Context

The IDP must support multiple engineering teams managing distinct projects with independent access controls. The platform handles sensitive data (secrets, API keys), requires real-time visibility (deployment status, notifications), and must produce an immutable audit trail for compliance purposes.

The system must be:
- **Multi-tenant at the organization level** — data isolation between orgs is a hard requirement.
- **Role-scoped** — permissions are enforced at the organization and project level independently.
- **Eventually consistent for non-critical paths** — webhook delivery and notification dispatch do not need to block API responses.
- **Strongly consistent for security-sensitive operations** — secret creation, API key issuance, and access control changes must be synchronous and durable.

---

## System Components

### Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│                                                                 │
│  ┌────────────────────────────┐   ┌────────────────────────┐   │
│  │     React Web App          │   │   External Consumers   │   │
│  │  (Vite · TS · TailwindCSS) │   │  (Webhooks · API keys) │   │
│  └────────────┬───────────────┘   └──────────┬─────────────┘   │
└───────────────┼──────────────────────────────┼─────────────────┘
                │ HTTPS / WSS                   │ HTTPS
┌───────────────▼──────────────────────────────▼─────────────────┐
│                         API LAYER                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Express API Server                    │   │
│  │                                                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │   │
│  │  │  Router  │→ │Middleware│→ │Controller│             │   │
│  │  └──────────┘  └──────────┘  └────┬─────┘             │   │
│  │                                   │                    │   │
│  │  ┌────────────────────────────────▼─────────────────┐ │   │
│  │  │              Service Layer                        │ │   │
│  │  │  (Business logic · Validation · Orchestration)   │ │   │
│  │  └────────────────────────────────┬─────────────────┘ │   │
│  │                                   │                    │   │
│  │  ┌────────────────────────────────▼─────────────────┐ │   │
│  │  │             Repository Layer                      │ │   │
│  │  │         (Data access abstraction)                 │ │   │
│  │  └──────────┬────────────────────┬──────────────────┘ │   │
│  └─────────────┼────────────────────┼────────────────────┘   │
└────────────────┼────────────────────┼────────────────────────┘
                 │                    │
┌────────────────▼───┐    ┌───────────▼────────────────────────┐
│  PERSISTENCE LAYER │    │         ASYNC LAYER                 │
│                    │    │                                     │
│  ┌──────────────┐  │    │  ┌──────────────┐  ┌────────────┐ │
│  │   MongoDB    │  │    │  │   BullMQ     │  │ Socket.IO  │ │
│  │  (Primary DB)│  │    │  │  (Job Queue) │  │ (Real-time)│ │
│  └──────────────┘  │    │  └──────┬───────┘  └─────┬──────┘ │
│  ┌──────────────┐  │    │         │                 │        │
│  │    Redis     │  │    │  ┌──────▼───────┐         │        │
│  │ (Cache/Rate) │  │    │  │   Workers    │         │        │
│  └──────────────┘  │    │  │  (Webhook,   │─────────┘        │
└────────────────────┘    │  │  Notif, Mail)│                  │
                          │  └──────────────┘                  │
                          └────────────────────────────────────┘
```

### Component Responsibilities

#### Express API Server
The single API process handles all incoming HTTP requests. It is structured in layers:

- **Router** — maps URLs to controller handlers; applies route-level middleware.
- **Middleware** — authentication, authorization (RBAC guard), rate limiting, request logging, Zod validation.
- **Controller** — parses request, calls service, serializes response. No business logic.
- **Service Layer** — all business logic, orchestration, and cross-domain coordination.
- **Repository Layer** — all MongoDB access. Services never call Mongoose directly.

#### MongoDB
Primary persistent storage. Chosen for:
- Document model fits naturally for heterogeneous metadata (project configs, deployment payloads, audit events).
- Change streams enable reactive patterns for audit log tailing.
- Atlas Search integration is viable for future full-text audit log search without additional infrastructure.

See [`database-design.md`](database-design.md) for schema decisions.

#### Redis
Used exclusively for:
- **Session/refresh token blocklist** — invalidated tokens stored with TTL equal to remaining token lifetime.
- **Rate limiting counters** — sliding window per IP and per API key.
- **BullMQ backend** — job queue persistence.
- **Pub/Sub for Socket.IO adapter** — enables horizontal scaling of WebSocket connections across multiple API instances.

Redis is **not** used as a primary data store. All data that must survive a Redis flush is in MongoDB.

#### BullMQ
Async job queue for:
- Webhook delivery (with exponential backoff retry)
- Email notifications
- Deployment simulation state machines
- Audit log flush batching

Workers run in the same Node.js process in development but are designed to be extracted into a separate worker process for production deployment.

#### Socket.IO
Real-time bidirectional communication for:
- Deployment status updates
- In-app notification delivery
- Environment health check results

The Redis adapter is configured from day one so Socket.IO scales horizontally without refactoring.

---

## Data Flow: Request Lifecycle

### Authenticated API Request

```
Client
  │
  │ POST /api/v1/projects/:projectId/secrets
  │ Authorization: Bearer <access_token>
  ▼
Express Router
  │
  ├─ authenticateJWT middleware
  │    └─ Verifies token, attaches req.user (userId, orgId, role)
  │
  ├─ authorizeRBAC('secrets:write') middleware
  │    └─ Checks org membership + project role from cache or DB
  │
  ├─ validateRequest(CreateSecretSchema) middleware
  │    └─ Zod parse of req.body; 400 on failure
  │
  ▼
SecretsController.create(req, res)
  │
  ▼
SecretsService.createSecret({ projectId, name, value, environment, actor })
  │
  ├─ Encrypt value with AES-256-GCM (per-project key from Vault or env)
  ├─ SecretsRepository.create(encryptedPayload)
  ├─ AuditLogService.record({ action: 'secret.created', actor, resource })
  │    └─ AuditLogRepository.create(event)  [fire-and-forget, no await]
  └─ Returns created secret (value redacted in response)
  │
  ▼
Controller serializes 201 response
```

### Webhook Delivery Flow

```
Event occurs (e.g., deployment.completed)
  │
  ▼
EventEmitter / Service dispatches WebhookJob
  │
  ▼
BullMQ Queue: 'webhooks'
  │
  ▼
WebhookWorker picks up job
  │
  ├─ Fetch webhook config (endpoint, secret, events filter)
  ├─ Sign payload: HMAC-SHA256(body, webhookSecret)
  ├─ POST to endpoint with X-IDP-Signature header
  │
  ├─ On success: log delivery record (status 2xx)
  │
  └─ On failure:
       ├─ Retry with exponential backoff (1s, 5s, 30s, 5m, 30m)
       └─ After 5 attempts: move to dead letter queue, alert owner
```

---

## Multi-Tenancy Model

The IDP uses **Organization-level tenancy**. Each user belongs to one or more organizations. All resources (projects, secrets, API keys, audit logs) are scoped to an organization.

**Tenant isolation is enforced at multiple layers:**

1. **JWT payload** — includes `orgId`. All requests carry the org context.
2. **Repository layer** — every query includes `{ organizationId }` as a mandatory filter. This is enforced by a base repository class, not left to individual query authors.
3. **Middleware** — `authorizeRBAC` verifies the user is an active member of the org in the token.

**Decision:** Shared database, shared collections with org-scoped documents (vs. separate database per org).

*Rationale:* At portfolio/startup scale, separate databases per org is operationally expensive and complicates cross-org analytics. The shared schema with mandatory `organizationId` filtering provides sufficient isolation. MongoDB Atlas supports row-level security via views if stricter isolation becomes a requirement.

---

## Scalability Considerations

### Current Design (Single Instance)
The initial deployment is a single API process with MongoDB Atlas and Redis. This handles thousands of concurrent users before hitting bottlenecks.

### Horizontal Scaling Path
The system is designed to scale horizontally without architectural changes:

- **API is stateless** — no in-process session state. All session data in Redis.
- **Socket.IO uses Redis adapter** — WebSocket connections distribute across instances.
- **BullMQ workers are process-portable** — extract to separate worker fleet without API changes.
- **MongoDB Atlas** — horizontal read scaling via replica set read preferences; vertical write scaling via Atlas tier upgrades.

### Known Bottlenecks
- **Audit log writes** — every action writes a log record. At high volume, batch these via BullMQ rather than synchronous writes. The service layer is already designed with this switch in mind (`AuditLogService` is the only caller).
- **Secret encryption** — CPU-bound. If secret volume spikes, encryption should move to a dedicated worker process.

---

## Security Boundaries

| Boundary | Mechanism |
|---|---|
| Client → API | HTTPS (TLS 1.3), JWT validation on every request |
| API key consumers | SHA-256 hashed keys stored in DB; comparison via constant-time compare |
| Secret values at rest | AES-256-GCM encryption; keys from environment (rotatable) |
| Webhook payloads | HMAC-SHA256 signature; consumers verify before processing |
| Admin operations | Requires `org:admin` role; logged to immutable audit trail |
| Rate limiting | Per-IP and per-API-key sliding window in Redis |

---

## Technology Decision Log

| Decision | Chosen | Rejected | Rationale |
|---|---|---|---|
| Primary database | MongoDB | PostgreSQL | Document model for flexible metadata; team familiarity; Atlas ecosystem |
| Queue system | BullMQ | SQS, RabbitMQ | Redis-native, TypeScript-first, simple local dev with same Redis instance |
| Auth strategy | JWT + refresh token | Session cookies | Stateless for API-first design; mobile/CLI client compatibility |
| Real-time | Socket.IO | SSE, long-poll | Bidirectional needed for deployment control plane; Redis adapter scales horizontally |
| Frontend state | TanStack Query + Zustand | Redux Toolkit | TanStack Query owns server state; Zustand for minimal client state only |
| Monorepo tool | Turborepo + pnpm | Nx, Yarn workspaces | Incremental builds; simple config; fast cache |

---

## Future Improvements

- **Extract worker process** — BullMQ workers should run in a separate container for independent scaling and failure isolation.
- **Introduce a dedicated secrets backend** — Currently uses envelope encryption with an env-variable-held key. Replace with HashiCorp Vault or AWS Secrets Manager for key rotation and audit without code changes.
- **Event sourcing for deployments** — Deployment state is currently a mutable document. Refactoring to an event log enables better rollback and time-travel debugging.
- **GraphQL federation** — If the platform expands to multiple backend services, a GraphQL gateway becomes viable. The current REST-first design does not preclude this.
- **Multi-region** — MongoDB Atlas Global Clusters + Redis Enterprise Active-Active enable multi-region if the user base grows globally.