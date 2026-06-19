# Architecture Decision Records — SELADEV IDP

## Purpose

This document is the central index and record of significant architectural decisions made during the design and development of SELADEV. Each Architecture Decision Record (ADR) captures:

- **Context** — the situation that required a decision
- **Decision** — what was chosen
- **Rationale** — why this option was selected
- **Consequences** — the resulting trade-offs
- **Alternatives Considered** — what was evaluated and rejected

ADRs are immutable once **Accepted**. If a decision is reversed, a new ADR supersedes it — the original record is not deleted. This preserves institutional memory about *why* decisions were made, preventing the same debates from recurring.

**Who should read this:**
- Engineers joining the project (understand why the codebase is structured this way)
- Engineers proposing changes to foundational patterns (understand what was already considered)
- Architects evaluating SELADEV's design (audit the decision-making process)

**How to add an ADR:**
See `CONTRIBUTING.md § Architecture Decisions` for the process and format.

---

## ADR Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| [ADR-001](#adr-001-mongodb-over-postgresql) | MongoDB over PostgreSQL | Accepted | 2026-05-01 |
| [ADR-002](#adr-002-bullmq-over-sqsrabbitmq) | BullMQ over SQS/RabbitMQ | Accepted | 2026-05-03 |
| [ADR-003](#adr-003-jwt-rs256-over-hs256) | JWT RS256 over HS256 | Accepted | 2026-05-05 |
| [ADR-004](#adr-004-feature-based-folder-structure-over-layer-based) | Feature-based folder structure over layer-based | Accepted | 2026-05-07 |
| [ADR-005](#adr-005-shared-database-multi-tenancy-over-database-per-tenant) | Shared database multi-tenancy over database-per-tenant | Accepted | 2026-05-10 |
| [ADR-006](#adr-006-tanstack-query--zustand-over-redux) | TanStack Query + Zustand over Redux | Accepted | 2026-05-12 |
| [ADR-007](#adr-007-turborepo--pnpm-monorepo-over-separate-repos) | Turborepo + pnpm monorepo over separate repos | Accepted | 2026-05-14 |
| [ADR-008](#adr-008-aes-256-gcm-with-per-org-derived-keys-over-per-secret-keys) | AES-256-GCM with per-org derived keys over per-secret keys | Accepted | 2026-05-18 |

---

## ADR-001: MongoDB over PostgreSQL

**Status:** Accepted  
**Date:** 2026-05-01

### Context

SELADEV stores several distinct data types with fundamentally different access patterns:

1. **Secrets** — flexible key-value pairs with environment and metadata. Schema evolves as users add custom fields. Typical access: read-by-org-and-project, not complex joins.
2. **Audit logs** — append-only, time-series, potentially millions of records. Access pattern: time-range queries with filtering.
3. **Deployments** — hierarchical status tree with embedded step logs. Schema changes frequently as the deployment pipeline model evolves.
4. **Org/project membership** — relational but read-heavy. Cached in Redis, so DB read frequency is low.
5. **Notifications** — ephemeral, high write frequency, time-to-live semantics.

The team has strong existing expertise in MongoDB and the MERN stack. The platform needs to ship fast.

### Decision

Use **MongoDB** (via Mongoose ODM) as the primary data store for all collections.

### Rationale

1. **Schema flexibility for secrets and deployments.** Secret metadata and deployment step structures are expected to evolve. Adding a new field to a MongoDB document is a zero-migration operation. In PostgreSQL, adding a nullable column requires an `ALTER TABLE` (safe in most cases but adds operational overhead).

2. **Embedded documents reduce join overhead.** Deployment step logs are embedded in the deployment document (`steps: []`). This means fetching a deployment and all its steps is a single document read — no join needed. In a relational model, this requires a `deployments JOIN deployment_steps` query.

3. **Horizontal scaling path.** MongoDB's sharding model is well-suited to multi-tenant data partitioned by `orgId`. When volume grows, sharding on `orgId` distributes load without application changes.

4. **Time-series optimization.** MongoDB 5.0+ introduced native time-series collections. Audit logs can be migrated to a time-series collection for automatic bucketing and compression — a significant storage advantage at scale.

5. **Team velocity.** The engineering team has deep Mongoose/MongoDB expertise. Choosing PostgreSQL would require learning a new ORM (Prisma or Drizzle), migration tooling, and SQL query patterns — introducing risk in an early-stage platform.

6. **Ecosystem fit.** MongoDB Atlas provides managed hosting with built-in encryption-at-rest, automated backups, multi-region replication, Atlas Search (full-text), and Atlas Charts — all relevant to SELADEV's roadmap.

### Consequences

**Positive:**
- Faster initial development velocity
- Schema evolution without migrations for most changes
- Simpler deployment of embedded document structures
- Native horizontal sharding path by `orgId`

**Negative:**
- No foreign key constraints — referential integrity is application-enforced. A deleted project can leave orphaned secrets until a cleanup job runs.
- No multi-document ACID transactions without explicit `session.startTransaction()`. Most operations in SELADEV are single-document writes, so this is acceptable. For multi-document operations (e.g., creating an org + default project atomically), sessions are required.
- Analytics and aggregation queries are more verbose than SQL. Complex DORA metric calculations require `$lookup` stages in aggregation pipelines.
- Harder to do ad-hoc reporting (no `SELECT ... WHERE ...` familiarity for non-engineers).

### Alternatives Considered

**PostgreSQL with Prisma:**
- Rejected due to: rigid schema requiring migrations for every secret metadata field change; `$lookup`-equivalent joins are cleaner in SQL but the team's SQL expertise is lower; no native time-series optimization without TimescaleDB extension.

**PostgreSQL with JSONB columns for secrets:**
- A hybrid approach — relational tables with JSONB for flexible metadata. Rejected: adds complexity without eliminating the migration overhead for non-JSONB columns. The operational hybrid is harder to reason about.

**DynamoDB:**
- Rejected: vendor lock-in to AWS; complex access pattern planning required upfront; local development story (DynamoDB Local) is inferior to `mongod`; no Mongoose-equivalent ODM for type safety.

---

## ADR-002: BullMQ over SQS/RabbitMQ

**Status:** Accepted  
**Date:** 2026-05-03

### Context

SELADEV requires an async job queue for:
- Deployment pipeline execution (stateful, multi-step, needs progress tracking)
- Outbound webhook delivery (retry with exponential backoff, dead letter queue)
- Email notification delivery (decoupled from request path)
- Audit log writes (decoupled from critical path for performance)

Requirements:
- **Retry with backoff** — failed webhook deliveries must retry up to 3 times
- **Job state visibility** — operators must be able to see queue depth, failed jobs, and retry status
- **Local development** — queue must work without cloud credentials in a local Docker environment
- **Low operational overhead** — the team does not want to operate a dedicated message broker
- **TypeScript-first** — type-safe job payloads

The team already uses Redis for the JWT blocklist and rate limiting. Redis is in the stack.

### Decision

Use **BullMQ** (Redis-backed job queue) as the async job processing layer.

### Rationale

1. **Redis is already in the stack.** BullMQ runs on Redis. Adding BullMQ has zero additional infrastructure cost — it uses the existing Redis instance. SQS or RabbitMQ would require a new managed service or self-hosted broker.

2. **Job state persistence and visibility.** BullMQ stores job state (waiting, active, completed, failed, delayed) in Redis sorted sets. The `@bull-board/express` UI gives operators real-time visibility into queue depth and failed job details — zero configuration. SQS provides no built-in failed job inspection UI.

3. **Rich retry semantics.** BullMQ supports configurable attempts, exponential backoff, fixed delay, and jitter — all needed for webhook delivery. SQS has limited built-in backoff (only via Visibility Timeout extension).

4. **Delayed jobs.** BullMQ supports scheduled/delayed jobs natively (a Redis sorted set by execution timestamp). Needed for: retry after delay, scheduled notification delivery.

5. **TypeScript-first API.** BullMQ is written in TypeScript with full type definitions. Job payloads are typed end-to-end:
   ```typescript
   const deploymentQueue = new Queue<DeploymentJobPayload>('deployments', { connection });
   ```

6. **Local development parity.** BullMQ + Redis runs identically in Docker locally and in production. SQS requires either LocalStack (complex setup) or a separate config path for local development.

### Consequences

**Positive:**
- No new infrastructure service required
- Zero-config job visibility dashboard
- Typed job payloads
- Delayed jobs, cron jobs, and rate-limited queues in one library
- Active OSS community, well-maintained

**Negative:**
- Redis becomes a critical dependency — if Redis goes down, all queues stop. Mitigated by Redis Sentinel or Redis Cluster for HA.
- BullMQ jobs are stored in Redis memory. For very high job volumes, Redis memory becomes a concern. Mitigated by `removeOnComplete` and `removeOnFail` limits on completed/failed jobs.
- No built-in dead letter queue concept — must simulate with a separate `dlq` queue and a `failed` event handler.
- Not suitable for massive fan-out (e.g., sending to 100,000 consumers) — for that scale, SQS/SNS or Kafka would be appropriate. SELADEV does not have that requirement in the current phase.

### Alternatives Considered

**AWS SQS + Lambda:**
- Rejected: vendor lock-in; requires IAM credentials in dev; no built-in job state visibility; Lambda cold start adds latency to webhook delivery; no TypeScript-native job payload typing.

**RabbitMQ:**
- Rejected: requires running a dedicated AMQP broker service (new infrastructure to operate); more complex exchange/queue configuration; team has no existing RabbitMQ expertise.

**Agenda (MongoDB-backed):**
- Rejected: MongoDB-backed queues have higher latency and lower throughput than Redis-backed; no concept of worker concurrency controls; actively less maintained than BullMQ.

**In-process event emitter (EventEmitter):**
- Rejected: no persistence across restarts; no visibility into job state; no retry; not suitable for production async work.

---

## ADR-003: JWT RS256 over HS256

**Status:** Accepted  
**Date:** 2026-05-05

### Context

SELADEV issues JWTs for API authentication. The JWT signing algorithm determines:
- How tokens are signed and verified
- How keys are managed and rotated
- What security guarantees are provided if a service is compromised

The two main options are:
- **HS256** — HMAC-SHA256 with a shared secret (symmetric)
- **RS256** — RSA Signature with SHA-256 using a public/private key pair (asymmetric)

### Decision

Use **RS256** (RSA-2048, SHA-256) for JWT signing.

### Rationale

1. **Asymmetric key model enables safe key distribution.** With RS256, the private key signs tokens and the public key verifies them. Services that only need to verify tokens (e.g., future microservices, third-party integrations) receive the public key only — not the private key. With HS256, every verifier needs the shared secret, making every service a potential attack target for key extraction.

2. **Key rotation without shared-secret synchronization.** Rotating an RS256 key pair requires updating the private key on the signing service and publishing the new public key at `/.well-known/jwks.json`. Existing tokens with the old key are valid until expiry. With HS256, all verifiers must receive the new shared secret simultaneously — a coordination problem at scale.

3. **JWKS endpoint for ecosystem compatibility.** RS256 keys can be published as a JSON Web Key Set (JWKS). Third-party services (future integrations, API gateways like Kong or AWS API Gateway) can auto-discover and auto-rotate verification keys by polling the JWKS endpoint. HS256 shared secrets cannot be published publicly.

4. **Smaller attack surface per service.** If a worker process or microservice is compromised, the attacker obtains only the public key — useless for forging tokens. With HS256, a single compromised service exposes the entire signing capability.

### Consequences

**Positive:**
- Safe key distribution to any number of verifiers
- JWKS-compatible for future API gateway integration
- Private key compromise scope is limited to the signing service
- Enables "verify-only" service role (receive public key, cannot forge)

**Negative:**
- RSA operations are computationally more expensive than HMAC. RS256 sign: ~1ms vs HS256 sign: ~0.05ms. At the expected scale (< 10,000 req/s), this is negligible.
- Private key is larger and more complex to manage than a shared secret. Mitigated by storing as a base64-encoded env variable.
- Key pair generation is a required deployment step (run `openssl genrsa` + `openssl rsa`). Documented in setup scripts.

### Alternatives Considered

**HS256:**
- Rejected because it requires sharing the signing secret with every verifying service — a security anti-pattern for a multi-service architecture.

**EdDSA (Ed25519):**
- A strong alternative — smaller keys, faster signatures, modern cryptography. Rejected for this phase because: fewer client library implementations for `Ed25519`; some older JWT libraries do not support it; RS256 is universally supported. EdDSA is preferred if the JWT library is replaced in the future.

**ES256 (ECDSA with P-256):**
- Also asymmetric and more modern than RS256. Rejected for the same reason as EdDSA — RS256 has the broadest library and gateway support, reducing integration risk.

---

## ADR-004: Feature-Based Folder Structure over Layer-Based

**Status:** Accepted  
**Date:** 2026-05-07

### Context

When organizing a Node.js/Express API codebase, two primary patterns exist:

**Layer-based (horizontal):**
```
src/
  controllers/
    auth.controller.ts
    secrets.controller.ts
  services/
    auth.service.ts
    secrets.service.ts
  repositories/
    auth.repository.ts
    secrets.repository.ts
```

**Feature-based (vertical):**
```
src/
  features/
    auth/
      auth.controller.ts
      auth.service.ts
      auth.repository.ts
      auth.routes.ts
      auth.schema.ts
    secrets/
      secrets.controller.ts
      secrets.service.ts
      ...
```

SELADEV has 10+ features (auth, secrets, projects, deployments, webhooks, audit logs, notifications, analytics, API keys, org management). The codebase is expected to grow to 15+ features.

### Decision

Use a **feature-based (vertical slice) folder structure** for all application code.

### Rationale

1. **Feature cohesion.** All code related to `secrets` lives in `src/features/secrets/`. A developer working on secrets does not need to navigate across `controllers/`, `services/`, and `repositories/` directories — everything is in one place. This reduces cognitive load and improves navigability.

2. **Reduced coupling.** Layer-based structure implicitly encourages cross-feature service calls (e.g., `secrets.service.ts` importing `auth.service.ts`). Feature-based structure makes dependencies explicit and encourages going through well-defined interfaces (`packages/shared`).

3. **Scalability to microservices.** Each feature folder can be extracted into an independent microservice with minimal restructuring — the folder already contains all the code for that service. See `roadmap.md § 6.1 Microservices Extraction`.

4. **Independent testability.** Each feature's tests live alongside its code (`features/secrets/__tests__/`). You can test a feature in complete isolation without understanding unrelated features.

5. **Team scalability.** Multiple engineers can work on different features simultaneously with minimal merge conflicts — changes to `secrets/` and `deployments/` are entirely separate file trees.

### Consequences

**Positive:**
- High cohesion within features
- Clear boundaries that map to future microservices
- Easy onboarding — new engineers can understand one feature at a time
- Low merge conflict rate across feature teams

**Negative:**
- Shared utilities and patterns must be explicitly placed in `packages/shared` or `src/lib`. It is tempting to duplicate utilities across features rather than extracting them — requires discipline.
- File count per feature can feel high for simple features (5+ files for a feature with one CRUD endpoint). Accept this — the structure is consistent and navigable.

### Alternatives Considered

**Layer-based structure:**
- Rejected because: at 10+ features, layer directories become unwieldy (30+ files per layer directory); navigating the codebase requires jumping across multiple directories for any feature change; no natural microservice extraction boundary.

**Hybrid (layers at top level, features within services):**
- Tried briefly during prototyping. Rejected: the hybrid creates ambiguity about where a new file belongs; inconsistency increases onboarding friction.

---

## ADR-005: Shared Database Multi-Tenancy over Database-Per-Tenant

**Status:** Accepted  
**Date:** 2026-05-10

### Context

SELADEV is a multi-tenant SaaS platform. Organizations (orgs) are the tenant boundary. Data for different orgs must be isolated — one org's users must not access another org's secrets, deployments, or audit logs.

Two primary multi-tenancy models exist:

**Database-per-tenant:** Each org gets its own MongoDB database (or cluster).
**Shared database:** All orgs share one database; every document is tagged with `orgId` and queries are scoped by `orgId`.

At MVP, SELADEV targets small-to-medium engineering teams. Large enterprise tenants with strict data isolation requirements are a Phase 4 consideration.

### Decision

Use **shared database multi-tenancy** with mandatory `orgId` scoping on every query.

### Rationale

1. **Operational simplicity.** Shared database means one MongoDB deployment to operate, back up, monitor, and upgrade. Database-per-tenant at 100 orgs means 100 databases — connection pooling complexity, backup scheduling for each, and migration scripts that must run against every tenant database.

2. **Cost efficiency.** MongoDB Atlas pricing scales with compute and storage, not database count — but the operational overhead of 100 separate databases does not justify the isolation benefit at MVP scale.

3. **Cross-tenant analytics.** Platform-level analytics (aggregate deployment frequency, feature adoption) are queries across all orgs. Shared database makes this trivial. Database-per-tenant requires a federated query layer.

4. **Architectural enforcement of isolation.** The `BaseRepository<T>` abstract class requires `orgId` as a TypeScript parameter on every query method. This makes cross-tenant data leakage a compile-time error, not a runtime risk. Database-per-tenant provides isolation via connection routing — which requires correct connection selection per request, an equally complex enforcement challenge.

5. **Schema migration simplicity.** Adding an index or new field to a collection happens once in a shared database. Database-per-tenant requires running the migration against every tenant's database in sequence.

### Consequences

**Positive:**
- Single deployment to operate
- Low cost at early scale
- Cross-tenant platform analytics trivially supported
- Schema migrations run once

**Negative:**
- A bug that bypasses `orgId` filtering is a cross-tenant data leak. Mitigated by: TypeScript enforcement at repository layer; integration tests that verify org isolation; code review checklist that checks for org scoping.
- "Noisy neighbor" — a high-throughput org can saturate shared MongoDB resources. Mitigated by: MongoDB Atlas Atlas-level rate limiting; query analysis per org; future: sharding by `orgId` on high-volume collections.
- Enterprise customers who require contractual data isolation (e.g., government, financial services) cannot be served without a database-per-tenant option. This is a Phase 4 consideration.

### Alternatives Considered

**Database-per-tenant:**
- Rejected for MVP due to: operational complexity; connection pool management at scale; migration complexity; no cross-tenant analytics without additional tooling. Revisit for enterprise tier (ADR to be written when scope is defined).

**Schema-per-tenant (PostgreSQL):**
- Not applicable to MongoDB (MongoDB does not have a schema concept equivalent to PostgreSQL schemas). Noted for completeness.

**Row-level security (PostgreSQL):**
- MongoDB does not have native row-level security. The equivalent (mandatory `orgId` in every query) is implemented at the application layer via `BaseRepository`. This is the chosen approach.

---

## ADR-006: TanStack Query + Zustand over Redux

**Status:** Accepted  
**Date:** 2026-05-12

### Context

The SELADEV React frontend needs state management for:

1. **Server state** — data fetched from the API: secrets list, project list, deployment status, audit logs, notifications
2. **UI state** — modal open/close, selected tab, form state, sidebar collapsed
3. **Real-time updates** — deployment status changes via Socket.IO, notification count

The team evaluated three approaches:
- **Redux Toolkit + RTK Query** — unified state management + data fetching
- **TanStack Query + Context API** — server state via TanStack Query, UI state via React Context
- **TanStack Query + Zustand** — server state via TanStack Query, UI state via Zustand

### Decision

Use **TanStack Query** for server state management and **Zustand** for global UI state.

### Rationale

1. **Separation of concerns.** Server state (async, needs caching, background refetching, loading/error states) is fundamentally different from UI state (synchronous, ephemeral, no caching). Conflating them in Redux adds accidental complexity — every API call requires an action, a reducer, a selector, and often a thunk or saga.

2. **TanStack Query handles server state perfectly.** Automatic background refetching, stale-while-revalidate caching, request deduplication, optimistic updates, infinite query support, and devtools — all out of the box. RTK Query provides similar features but with more Redux boilerplate and tighter coupling to Redux.

3. **Zustand's API surface is minimal.** A Zustand store is a function call that returns a hook:
   ```typescript
   const useUIStore = create<UIStore>((set) => ({
     sidebarOpen: true,
     setSidebarOpen: (open) => set({ sidebarOpen: open }),
   }));
   ```
   Redux Toolkit requires: `createSlice`, `createAsyncThunk`, `configureStore`, `Provider`, `useSelector`, `useDispatch`. Zustand eliminates the Provider, the selector boilerplate, and the action/reducer split.

4. **Smaller bundle size.** TanStack Query (13KB gzip) + Zustand (1KB gzip) = 14KB. Redux Toolkit (11KB) + React-Redux (5KB) + RTK Query (included in RTK) ≈ 16KB. The difference is small but directional.

5. **Socket.IO integration is easier.** Real-time updates from Socket.IO can directly invalidate TanStack Query cache keys (`queryClient.invalidateQueries`) without routing through Redux actions. Zustand can hold the socket connection reference and expose subscription helpers.

### Consequences

**Positive:**
- Less boilerplate for data fetching (no actions/reducers per endpoint)
- Automatic caching, deduplication, and background refetching
- Simple global UI state with Zustand
- Easier Socket.IO integration

**Negative:**
- Two state management libraries instead of one. Engineers must understand which state belongs where. Mitigated by documented guidelines: server data → TanStack Query; global UI state → Zustand; local component state → `useState`.
- Redux DevTools are not available (Zustand has its own devtools middleware but less ecosystem support).
- Team members familiar with Redux must learn TanStack Query's mental model (queries vs mutations, cache keys, invalidation).

### Alternatives Considered

**Redux Toolkit + RTK Query:**
- Rejected: excessive boilerplate for data fetching; RTK Query's cache invalidation is tag-based (less flexible than TanStack Query's key-based invalidation); Redux's global store is overkill for simple UI state.

**TanStack Query + Context API:**
- Rejected: Context API re-renders all consumers on every state change — a performance problem for frequently updated state (e.g., notification count, sidebar toggle). Zustand uses selective subscriptions.

**Jotai / Recoil (atomic state):**
- Considered but rejected: atomic state model works well for highly granular state (e.g., form field by field) but adds complexity for coarser global state. Zustand's simpler slice-based model is a better fit for SELADEV's UI state needs.

---

## ADR-007: Turborepo + pnpm Monorepo over Separate Repos

**Status:** Accepted  
**Date:** 2026-05-14

### Context

SELADEV consists of multiple deployable units and shared packages:
- `apps/api` — Express API server
- `apps/web` — React frontend (Vite)
- `apps/worker` — BullMQ background workers
- `packages/shared` — shared TypeScript utilities, constants, error classes
- `packages/types` — shared TypeScript types and Zod schemas
- `packages/config` — shared ESLint, TypeScript, Vitest configs

Options evaluated:
- **Polyrepo** — each app/package in its own repository
- **Monorepo with npm workspaces + custom scripts** — simple but no build caching
- **Monorepo with Turborepo + pnpm workspaces** — build caching, task pipeline, remote caching

### Decision

Use a **pnpm workspaces monorepo orchestrated by Turborepo**.

### Rationale

1. **Shared code without npm publish overhead.** `packages/types` defines the shared Zod schemas and TypeScript interfaces used by both the API (for validation) and the web app (for form schemas). In a polyrepo, every change to shared types requires: a version bump, an npm publish, and dependency updates in consuming repos. In a monorepo, the change is instantaneous — the workspace dependency resolves to the local package.

2. **Turborepo build caching.** Turborepo caches task outputs (build artifacts, test results) keyed by file content hash. If `packages/shared` hasn't changed, its `build` task is skipped and the cached artifact is used. This cuts CI build times by 50–70% after the first run.

3. **Atomic cross-package changes.** A change to a shared type that requires updates in both the API and web app is a single PR with changes across multiple packages. In a polyrepo, this is three PRs with synchronized merges — a coordination nightmare.

4. **Unified tooling.** One ESLint config, one TypeScript config, one Vitest config — all in `packages/config`. Every package extends the shared config. No drift in linting rules between repos.

5. **pnpm over npm/yarn.** pnpm's content-addressed store means each version of a package is stored once on disk — shared across all projects on the machine. `node_modules` uses symlinks to the store, reducing disk usage and install time by 40–60% compared to npm.

6. **Remote caching (Turborepo Cloud or Vercel).** With remote caching enabled, CI runs on different machines share the same cache. A build that passes in one PR's CI does not re-run for a subsequent PR that doesn't touch the same files.

### Consequences

**Positive:**
- Shared code changes are instant, atomic, and single-PR
- Fast CI with task-level caching
- Consistent tooling across all packages
- Easier onboarding — one clone, one `pnpm install`

**Negative:**
- All engineers must install pnpm. Mitigated by `engines` field in `package.json` enforcing pnpm and the version.
- Turborepo configuration (`turbo.json`) is a new concept for engineers unfamiliar with monorepo build tools. Mitigated by documented task pipeline in `folder-structure.md`.
- A bug in `packages/shared` breaks all consumers simultaneously. Mitigated by pre-commit tests and CI gates.
- Repository size grows as all packages accumulate history. For SELADEV's scale, this is not a concern within the 18-month horizon.

### Alternatives Considered

**Polyrepo (separate GitHub repos):**
- Rejected: cross-package type changes require 3 PRs + coordinated merges; no shared tooling enforcement; local development requires cloning multiple repos and running `npm link`; CI cannot cache across repo boundaries.

**Nx:**
- A strong alternative to Turborepo. Nx has more built-in generators and plugins. Rejected: steeper learning curve; more configuration complexity for SELADEV's relatively simple build requirements; Turborepo's `turbo.json` is simpler to reason about.

**Lerna (legacy):**
- Rejected: Lerna's active maintenance period has ended for its task-runner features; Turborepo supersedes it for build caching.

---

## ADR-008: AES-256-GCM with Per-Org Derived Keys over Per-Secret Keys

**Status:** Accepted  
**Date:** 2026-05-18

### Context

SELADEV's secret vault stores sensitive values (API keys, database credentials, environment-specific config) that must be encrypted at rest. Two key management strategies were considered:

**Option A: Per-secret keys** — generate a random 32-byte key for each secret, store the key alongside the ciphertext (encrypted under a master key).

**Option B: Per-org derived keys** — derive a 32-byte key from the master key + orgId using HKDF, use this key to encrypt all secrets belonging to that org.

### Decision

Use **AES-256-GCM with per-org derived keys via HKDF-SHA256**.

```
Master Key (env: ENCRYPTION_MASTER_KEY, 32 bytes)
    │
    ▼  HKDF-SHA256(ikm=masterKey, salt=orgId, info="seladev-secret-encryption")
    │
Per-Org Key (32 bytes, deterministic)
    │
    ▼  AES-256-GCM(key=orgKey, iv=random 12 bytes per encryption)
    │
Ciphertext + AuthTag (stored in MongoDB)
```

### Rationale

1. **No key storage overhead.** Per-org derived keys are computed on demand from `masterKey + orgId` — they are never stored. Per-secret keys require storing N keys (one per secret), each of which must itself be encrypted under the master key. At 10,000 secrets, this means 10,000 stored key ciphertexts to manage, rotate, and back up.

2. **Blast radius is bounded to the org level.** If an org-derived key is somehow extracted (e.g., from memory via a vulnerability), only that org's secrets are compromised. Keys of other orgs are derived from different HKDF inputs and are computationally independent. This is equivalent to per-secret key isolation at the org granularity — which is the meaningful security boundary in a multi-tenant system.

3. **GCM authentication tag provides integrity.** AES-256-GCM produces a 16-byte authentication tag per encrypted value. Any tampering with the ciphertext is detected on decrypt (GCM verify fails). This eliminates the need for a separate MAC step.

4. **Key rotation is feasible.** Master key rotation requires re-encrypting all secrets, but this is a single bulk operation (admin-triggered migration job). Per-secret keys would require the same bulk operation with the additional complexity of re-encrypting the key wrappers as well.

5. **Per-secret IVs maintain semantic security.** Even though all secrets in an org are encrypted with the same derived key, each encryption uses a randomly generated 12-byte IV. This ensures that encrypting the same value twice produces different ciphertexts (semantic security), preventing the key from being derived via chosen-plaintext analysis.

### Consequences

**Positive:**
- Zero key storage overhead
- Deterministic key derivation — the key for any org can be recomputed from the master key + orgId
- Org-level blast radius on key exposure
- Simple implementation (one HKDF call + one AES-GCM operation)
- GCM integrity check on every decrypt

**Negative:**
- Org-level (not secret-level) isolation. If the org-derived key is compromised, all secrets for that org are exposed. This is acceptable because the meaningful security boundary is the org, not the individual secret.
- Rotating secrets for a single org (in response to a breach) requires re-encrypting all of that org's secrets with a new derived key. This requires changing the HKDF input (e.g., appending a `keyVersion` to the HKDF info string) and migrating documents.
- If the master key is compromised, all org-derived keys can be re-derived — all secrets are compromised. Mitigated by moving the master key to AWS KMS or HashiCorp Vault (planned in `security.md § Future Improvements`).

### Alternatives Considered

**Per-secret keys (envelope encryption):**
- Rejected: adds 10,000 key documents to store, manage, and back up for a 10,000-secret vault; adds a second decryption operation (decrypt key wrapper, then decrypt value) on every secret read; more complex rotation logic.

**Fixed global key (one key for all orgs):**
- Rejected: catastrophic blast radius — compromise of one org's key (or the global key) exposes all orgs' secrets.

**AWS KMS direct encryption:**
- Strong option for production hardening. AWS KMS performs the encryption/decryption call directly (no key material leaves KMS). Rejected for MVP because: requires AWS SDK dependency and IAM configuration in development; KMS adds 50–100ms per encrypt/decrypt API call (network round-trip); cost at high secret access frequency. Planned as a future enhancement (swap the encryption backend to use KMS envelope encryption with a data key).

**HashiCorp Vault Transit secrets engine:**
- The ideal production solution — Vault manages keys, performs encryption, supports automatic rotation. Rejected for MVP: requires operating a Vault cluster; adds infrastructure complexity before product-market-fit. Planned in `roadmap.md § Phase 4`.

---

*Document version: 1.0 | Last updated: 2026-06-19 | Owner: Platform Architecture*
