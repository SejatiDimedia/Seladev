# Changelog

All notable changes to SELADEV will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- MFA / TOTP enrollment endpoint (Phase 2 — in design)
- Secret versioning with rollback capability (Phase 2 — in design)
- SSO / SAML 2.0 SP-initiated login flow (Phase 2 — in design)
- API key environment scoping (restrict key to dev/staging/production secrets) (Phase 2 — in design)

### Changed

- Nothing yet

### Deprecated

- Nothing yet

### Removed

- Nothing yet

### Fixed

- Nothing yet

### Security

- Nothing yet

---

## [0.1.0] — 2026-06-19

### Summary

Initial architecture, documentation, and infrastructure release for SELADEV IDP. This release establishes all foundational design decisions, the monorepo structure, and the platform's core technical contracts. No production application code is shipped in this release — this is the design and architecture baseline from which all feature development proceeds.

### Added

#### Documentation

- **`docs_project/system-design.md`** — Component boundaries, data flow, tech stack decisions, and high-level architecture overview. Includes ASCII component diagrams, service interaction maps, and rationale for the MERN + BullMQ + Socket.IO architecture.

- **`docs_project/database-design.md`** — Complete MongoDB schema definitions for all collections: `users`, `organizations`, `memberships`, `projects`, `environments`, `secrets`, `secret_versions`, `api_keys`, `deployments`, `webhooks`, `webhook_deliveries`, `audit_logs`, `notifications`. Includes indexing strategy, encryption design, and multi-tenant scoping approach.

- **`docs_project/api-design.md`** — REST API conventions: URL structure (`/api/v1/...`), versioning policy, standard request/response envelope, error contract (`code`, `message`, `details`), pagination contract (cursor + offset), HTTP status code usage, and authentication header format.

- **`docs_project/auth-design.md`** — Complete authentication and authorization design: JWT RS256 token strategy, access token and refresh token lifecycle, refresh token rotation algorithm with reuse detection, RBAC two-tier model (org roles + project roles), middleware layering, and access token blocklist via Redis.

- **`docs_project/frontend-architecture.md`** — React frontend architecture: feature-based folder structure, TanStack Query data fetching and caching strategy, Zustand global state management, React Hook Form + Zod validation pattern, shadcn/ui component system, and Socket.IO real-time integration.

- **`docs_project/folder-structure.md`** — Monorepo folder structure reference: Turborepo workspace layout, `apps/api`, `apps/web`, `apps/worker`, `packages/shared`, `packages/types`, `packages/config`. Feature-based organization within each app.

- **`docs_project/testing-strategy.md`** — Testing pyramid for SELADEV: unit tests (Vitest, Jest), integration tests (Supertest), E2E tests (Playwright). Coverage contracts per package, test patterns for auth flows, repository mocking strategy, and CI integration.

- **`docs_project/security.md`** — Comprehensive security design: threat model (STRIDE), authentication security controls, authorization enforcement layers, data encryption at rest, transport security, input validation, CORS, rate limiting, audit trail, webhook security, dependency security, OWASP Top 10 coverage, and incident response outline.

- **`docs_project/monitoring.md`** — Observability strategy: structured JSON logging (Winston), log field schema, log level guidelines, request logging middleware, health check endpoints, performance metrics, alerting thresholds, BullMQ monitoring, MongoDB monitoring, Redis monitoring, and dashboard design.

- **`docs_project/performance.md`** — Performance strategy and targets: SLA targets per endpoint category, database query optimization rules, N+1 prevention patterns, Redis caching strategy, BullMQ backpressure handling, event loop protection, streaming for large datasets, frontend bundle splitting, TanStack Query stale time strategy, virtual list rendering, Core Web Vitals targets, cursor pagination, response compression, ETags, and k6 load testing approach.

- **`docs_project/roadmap.md`** — Product and engineering roadmap: 18-month vision, Phase 1 (MVP — current), Phase 2 (MFA + SSO + secret versioning), Phase 3 (CI/CD integration + GraphQL + analytics), Phase 4 (microservices + multi-region + mobile), technical debt tracker, open source considerations, and enterprise readiness checklist.

- **`docs_project/adr.md`** — Architecture Decision Records index with 8 embedded ADRs: MongoDB over PostgreSQL, BullMQ over SQS/RabbitMQ, JWT RS256 over HS256, feature-based folder structure over layer-based, shared-database multi-tenancy, TanStack Query + Zustand over Redux, Turborepo + pnpm monorepo, and AES-256-GCM with per-org derived keys.

- **`CONTRIBUTING.md`** — Full contributor guide: getting started, branch naming, Conventional Commits convention, development workflow, PR requirements, code review guidelines, testing requirements, documentation requirements, release process, and ADR guidance.

- **`CHANGELOG.md`** — This file. Initialized with Keep a Changelog format.

#### Infrastructure Design

- **Monorepo structure** established with Turborepo + pnpm workspaces. Pipeline configuration defined for `build`, `test`, `lint`, `dev` tasks with correct dependency ordering.

- **Docker Compose** development configuration (`docker-compose.dev.yml`) with MongoDB, Redis, and BullMQ Board services for local development.

- **GitHub Actions CI** pipeline design covering: lint, type check, unit tests, integration tests, E2E tests, bundle size check, npm security audit, and changeset-based release automation.

#### Core Architecture Decisions

- **Two-tier RBAC model** defined and locked:
  - Org roles: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
  - Project roles: `PROJECT_ADMIN`, `PROJECT_DEVELOPER`, `PROJECT_VIEWER`
  - Permission matrix documented in `auth-design.md`

- **AES-256-GCM secret encryption** architecture with per-org key derivation:
  - Master key stored as environment secret (`ENCRYPTION_MASTER_KEY`, 32 bytes)
  - Per-org keys derived via HKDF-SHA256 (deterministic, no key storage required)
  - Each encrypted value stores: `ciphertext`, `iv` (12 bytes, unique per write), `authTag` (16 bytes), `keyVersion`
  - See `ADR-008` in `docs_project/adr.md`

- **JWT RS256 + refresh token rotation** strategy:
  - Access tokens: 15-minute lifetime, RS256-signed, revocable via Redis blocklist
  - Refresh tokens: 7-day lifetime, `HttpOnly` + `Secure` + `SameSite=Strict` cookie, scoped to `/api/v1/auth/refresh`
  - Token family model for reuse detection
  - See `ADR-003` in `docs_project/adr.md`

- **BullMQ async job queues** defined:
  - `deployments` — deployment pipeline execution
  - `webhooks` — outbound webhook delivery with retry
  - `notifications` — email + in-app notification delivery
  - `audit-log-writes` — decoupled audit log persistence
  - See `ADR-002` in `docs_project/adr.md`

- **Feature-based folder structure** adopted over layer-based:
  - Each feature (`auth`, `secrets`, `deployments`, etc.) is a self-contained folder with routes, controller, service, repository, schema, and tests
  - See `ADR-004` in `docs_project/adr.md`

- **Shared database multi-tenancy** with `orgId` scoping on every collection:
  - All queries include mandatory `orgId` filter (enforced at repository base class via TypeScript)
  - Cross-tenant data access is architecturally prevented at the type system level
  - See `ADR-005` in `docs_project/adr.md`

---

## Release Notes Format

Each version entry follows this structure:

```
## [X.Y.Z] — YYYY-MM-DD

### Added       — new features
### Changed     — changes to existing functionality
### Deprecated  — features that will be removed in a future release
### Removed     — features removed in this release
### Fixed       — bug fixes
### Security    — security vulnerability fixes (always include CVE if applicable)
```

---

[Unreleased]: https://github.com/seladev/seladev/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/seladev/seladev/releases/tag/v0.1.0
