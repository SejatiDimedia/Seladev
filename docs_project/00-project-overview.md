# SELADEV — Project Overview

> **"The Unified Developer Platform to Bridge Your Code and Cloud Deployment."**

---

## Table of Contents

1. [What is SELADEV?](#1-what-is-seladev)
2. [Why It Exists — The Problem](#2-why-it-exists--the-problem)
3. [Who Uses It — Target Users](#3-who-uses-it--target-users)
4. [What Problems It Solves](#4-what-problems-it-solves)
5. [Core Value Propositions](#5-core-value-propositions)
6. [Product Pillars](#6-product-pillars)
7. [What SELADEV Is NOT](#7-what-seladev-is-not)
8. [Portfolio & Flagship Positioning Rationale](#8-portfolio--flagship-positioning-rationale)
9. [High-Level Architecture](#9-high-level-architecture)
10. [Success Metrics](#10-success-metrics)

---

## 1. What is SELADEV?

**SELADEV** (pronounced *Se·la·dev*) is a modern, web-based **Internal Developer Platform (IDP)** built for engineering teams that need a single, authoritative control plane over their software delivery infrastructure.

It unifies identity & access, project configuration, secret management, API key lifecycle, deployment orchestration, event webhooks, audit compliance, and real-time notifications — all under one cohesive interface and API surface.

SELADEV is built as a **production-grade portfolio flagship** using the MERN stack (MongoDB, Express.js, React, Node.js) with full TypeScript coverage, demonstrating enterprise patterns at a level of rigor typically seen in well-funded SaaS products.

| Attribute          | Detail                                               |
|--------------------|------------------------------------------------------|
| **Brand**          | SELADEV                                              |
| **Domain**         | seladev.dev / seladev.com                            |
| **Type**           | Internal Developer Platform (IDP) — SaaS             |
| **Stack**          | MERN + TypeScript, pnpm monorepo, Turborepo          |
| **Architecture**   | Clean Architecture, Repository Pattern, Feature-based |
| **Multi-tenancy**  | Org-level tenant isolation, shared database          |
| **Auth model**     | JWT RS256 + refresh token rotation, RBAC             |

---

## 2. Why It Exists — The Problem

### The Fragmentation Problem in Modern Engineering Teams

Engineering teams today operate across a sprawling set of disconnected tools:

- Secrets are stored in one tool (Vault, AWS Secrets Manager, Doppler), with no integrated access audit
- API keys are issued manually via spreadsheets or scattered service dashboards, with no rotation tracking
- Deployment status lives inside CI/CD pipelines that only DevOps engineers can interpret
- Audit logs are either nonexistent or locked inside cloud provider consoles with restricted access
- Notifications about production events route through ad-hoc Slack bots with no ownership model
- Project onboarding requires manually provisioning access across 4–6 different systems

The result is **platform sprawl**: high cognitive load, inconsistent access control, opaque security posture, and a dramatically slow developer onboarding experience.

### The Specific Pain Points

```
┌─────────────────────────────────────────────────────────────────┐
│  WITHOUT A UNIFIED IDP                                          │
│                                                                 │
│  Dev A needs a secret      → Asks DevOps in Slack              │
│  Dev B rotates an API key  → Updates 3 spreadsheets manually   │
│  Lead C reviews a deploy   → Opens 4 different dashboards      │
│  Auditor D needs a log     → Submits a ticket, waits 2 days    │
│  New engineer onboards     → 2 weeks to get full access        │
└─────────────────────────────────────────────────────────────────┘
```

Modern teams need a **unified control plane** — a single system of record for the operational surface of a software product that every team member can use according to their role.

---

## 3. Who Uses It — Target Users

SELADEV is designed for **three primary user archetypes** in engineering organizations of 5–200 engineers:

### Platform Engineer / DevOps Lead

The person responsible for infrastructure integrity. They configure organizations, onboard projects, manage environment topology (dev/staging/prod), enforce secret rotation policies, set up webhook endpoints for downstream automation, and review audit trails for compliance.

**Primary needs:** Full system access, audit visibility, deployment control, webhook management, org-level RBAC configuration.

**Typical actions:**
- Create and configure the organization and initial projects
- Assign `org_admin` and `project_admin` roles to team leads
- Review immutable audit logs for security incident investigation
- Configure webhook endpoints pointing to downstream automation (Slack, PagerDuty, custom services)
- Monitor deployment pipeline health and analytics

### Engineering Team Lead

Responsible for a product squad. They manage project membership, review deployment frequency and error rates in analytics, approve environment promotions, and configure project-level secrets for their team.

**Primary needs:** Project-scoped admin, environment management, deployment visibility, team member role assignments.

**Typical actions:**
- Onboard a new developer by assigning them the `developer` role in their project
- Create and manage secrets for `staging` and `production` environments
- Monitor real-time deployment status across their squad's services
- Issue project-scoped API keys for CI/CD integration
- Review analytics for deployment frequency and failure rate trends

### Application Developer

Day-to-day builder consuming the platform. They read environment variables and secrets (never raw values by default), trigger deployments, view their team's deployment history, receive real-time notifications, and use issued API keys to authenticate their services.

**Primary needs:** Scoped read access to secrets, deployment initiation, API key consumption, real-time status updates.

**Typical actions:**
- View (masked) secrets and environment variables for their assigned project
- Trigger a deployment and watch it progress in real time
- Receive a push notification when their deployment fails
- Look up their API key details (scope, expiry) without being able to see other teams' keys

---

## 4. What Problems It Solves

SELADEV directly replaces or consolidates the following workflows:

| Problem Domain             | Without SELADEV                          | With SELADEV                                     |
|----------------------------|------------------------------------------|--------------------------------------------------|
| **Secret Distribution**    | Manual copy-paste from Vault/SSM         | Encrypted storage, scoped RBAC, masked display   |
| **API Key Management**     | Spreadsheets, no expiry tracking         | Scoped issuance, rotation, expiry alerts         |
| **Deployment Visibility**  | Buried in CI logs                        | Real-time status pipeline with Socket.IO         |
| **Access Control**         | Per-tool manual provisioning             | Org + project RBAC in one place                  |
| **Audit Compliance**       | No log, or logs locked in cloud consoles | Immutable audit trail, actor + resource tracking |
| **Event Notifications**    | Ad-hoc Slack bots                        | In-app + email via BullMQ event queue            |
| **Developer Onboarding**   | 2-week multi-tool setup                  | Role grant → instant scoped access               |
| **Usage Analytics**        | Separate BI tools or none                | Built-in deployment frequency + error rate views |

---

## 5. Core Value Propositions

### 5.1 Developer Experience (DX) First

SELADEV is designed from the outside-in — the developer workflow is the primary design constraint. The UI is built with React, shadcn/ui, and TanStack Query for instant perceived performance and optimistic updates. The API contract follows REST conventions that are consistent, predictable, and fully documented via OpenAPI/Swagger.

Every interaction is designed to have zero ambiguity: what a user can see, what they can do, and what happened when something went wrong are always surfaced clearly.

### 5.2 Enterprise-Grade Security Without Enterprise Complexity

- Secrets are encrypted at rest using **AES-256-GCM** with per-value initialization vectors
- Authentication uses **RS256 JWT** with short-lived access tokens (15 minutes) and rotating refresh tokens (7 days)
- API keys carry HMAC-SHA256 signatures and scope claims validated at the middleware layer
- Webhooks are signed with **HMAC-SHA256** on every delivery for payload authenticity verification
- All sensitive operations write to an immutable audit log — no delete, no update, enforced at the repository layer

### 5.3 Real-Time Orchestration

SELADEV surfaces real-time state to developers without polling. Deployment status, notification delivery, and system events are streamed via **Socket.IO** backed by **BullMQ** on Redis. A developer triggering a deployment sees live status transitions (`QUEUED → BUILDING → DEPLOYING → SUCCESS`) in the UI without a browser refresh.

### 5.4 Unified Control Plane

Every operational concern — from secret creation to deployment failure to API key expiry — is traceable to a single actor, a single resource, and a single event in the audit log. There is no "off-platform" operational activity for anything SELADEV owns.

---

## 6. Product Pillars

SELADEV is organized around **nine product pillars**, each responsible for a distinct operational domain:

### Pillar 1 — Identity & Access

JWT authentication with RS256 signing, refresh token rotation, and cookie-based secure token delivery. Role hierarchy: `super_admin > org_admin > project_admin > developer > viewer`. RBAC is enforced at both the org level and the project level independently, allowing fine-grained access control across a multi-project organization.

**Key modules:** `auth/`, `users/`, `rbac/`

### Pillar 2 — Project Management

Multi-tenant project isolation. Projects belong to organizations. Each project carries a set of environments (e.g., `development`, `staging`, `production`). Members are assigned roles per project independently of their org-level role. Project creation, archival, and environment topology are managed here.

**Key modules:** `organizations/`, `projects/`, `environments/`, `members/`

### Pillar 3 — Secrets & Config

AES-256-GCM encrypted secret storage. Secrets are scoped to environments. Developers with the `developer` role see masked values by default; `project_admin` and above can reveal plaintext. Full version history is maintained. Bulk import/export is supported. Secret expiry warnings are surfaced via the notification system.

**Key modules:** `secrets/`

### Pillar 4 — API Keys

First-class API key lifecycle management. Keys are issued with scopes (e.g., `deployments:read`, `secrets:read`), expiry dates, and human-readable descriptions. Rotation generates a new key and invalidates the predecessor atomically. All issuance and rotation events are audit-logged with full actor context.

**Key modules:** `api-keys/`

### Pillar 5 — Deployments

Simulated deployment pipeline backed by **BullMQ** queue workers on Redis. Status transitions: `QUEUED → BUILDING → DEPLOYING → SUCCESS | FAILED | CANCELLED`. Real-time status is pushed to subscribed clients via Socket.IO. Full deployment history is retained per environment with actor attribution.

**Key modules:** `deployments/`

### Pillar 6 — Webhooks

Event-driven webhook delivery. Teams configure endpoint URLs and subscribe to event types (e.g., `deployment.succeeded`, `deployment.failed`, `secret.updated`, `api_key.rotated`). Payloads are signed with HMAC-SHA256. Failed deliveries are retried with exponential backoff; exhausted retries move to a dead letter queue for inspection.

**Key modules:** `webhooks/`

### Pillar 7 — Audit Logs

Immutable, append-only log of every state-changing operation on the platform. Each record captures: actor ID, actor email, actor role, action type, resource type, resource ID, org/project context, IP address, user agent, timestamp, and a metadata diff. No audit record can be deleted or modified — enforced at the repository layer by omitting all delete/update operations.

**Key modules:** `audit-logs/`

### Pillar 8 — Notifications

Real-time in-app notifications delivered via Socket.IO, with async email delivery via BullMQ and an email provider (SMTP/SendGrid). Notification types: deployment events, secret expiry warnings, API key expiry, webhook delivery failures, and role changes. Users control their notification preferences per category.

**Key modules:** `notifications/`

### Pillar 9 — Analytics

Platform-level usage metrics: deployment frequency per project/environment, deployment success/failure rate, API key usage frequency, secret access count, webhook delivery success rate. Surfaced as aggregated time-series data to org admins and project leads. Data is computed from existing records (no separate analytics store in v1).

**Key modules:** `analytics/`

---

## 7. What SELADEV Is NOT

Understanding the platform boundary is as important as understanding its capabilities. The following are explicitly out of scope:

| Misconception                                | Reality                                                                  |
|----------------------------------------------|--------------------------------------------------------------------------|
| **A CI/CD pipeline runner**                  | SELADEV orchestrates deployments but does not run build agents, compile code, or replace GitHub Actions / CircleCI / Jenkins |
| **A secret manager replacement**             | SELADEV manages secrets within its own encrypted store but does not sync with or proxy AWS Secrets Manager, HashiCorp Vault, or Doppler |
| **A full GitOps platform**                   | There is no Git repository integration, no ArgoCD-style reconciliation loop, and no infrastructure-as-code execution |
| **An APM or observability platform**         | SELADEV shows deployment status and basic usage analytics — not distributed traces, application logs, or infrastructure metrics |
| **A container orchestration tool**           | SELADEV does not manage Kubernetes clusters, Docker swarms, ECS services, or serverless functions |
| **A billing or subscription manager**        | SELADEV does not handle payment processing, usage-based billing, or plan tier management |
| **A feature flag system**                    | SELADEV manages secrets and config values but is not designed for runtime feature toggling with SDKs (e.g., LaunchDarkly, Unleash) |
| **A service mesh or API gateway**            | SELADEV issues API keys but does not proxy or rate-limit external API traffic |

---

## 8. Portfolio & Flagship Positioning Rationale

### Why MERN?

MERN (MongoDB, Express, React, Node.js) is the dominant full-stack TypeScript ecosystem for web applications. Choosing it signals fluency in the stack that the majority of web product companies actually ship on. Key advantages:

- **Unified language across the entire stack** — TypeScript from Mongoose schema to React component to API response type
- **Ecosystem depth** — mature libraries for auth (`jsonwebtoken`, `bcrypt`), queuing (`BullMQ`), real-time (`Socket.IO`), validation (`Zod`), and testing (`Vitest`, `Supertest`, `Playwright`)
- **Deployment simplicity** — Docker Compose covers dev, staging, and production without requiring Kubernetes or cloud-specific tooling
- **Hiring signal** — MERN proficiency is specifically listed in the majority of Senior/Staff fullstack job descriptions

### Why This Complexity Level?

SELADEV is deliberately engineered to the standard of a real production SaaS, not a "just enough to demo" portfolio project. The engineering choices reflect what a Staff Engineer would select for a B2B SaaS product:

| Pattern | Why Chosen |
|---|---|
| Clean Architecture + Repository Pattern | Every data access sits behind an interface, enabling unit testing without live MongoDB |
| Feature-based folder structure | Scales with team size; each feature is a self-contained vertical slice |
| pnpm monorepo + Turborepo | Demonstrates enterprise build tooling: caching, incremental builds, workspace management |
| BullMQ + Redis | Demonstrates async job processing patterns required in all production web platforms |
| RS256 JWT (not HS256) | Demonstrates PKI-based token signing appropriate for distributed/microservice systems |
| Full test pyramid (Vitest + Supertest + Playwright) | Demonstrates quality discipline across unit, integration, and E2E layers |

### Why an IDP?

Internal Developer Platforms are the canonical "hard problem" in platform engineering. Building one requires:
- Multi-tenant data modeling with tenant isolation at query level
- Complex RBAC with org and project scoping that compose correctly
- Async job orchestration with retry and dead letter semantics
- Real-time communication with room-scoped subscriptions
- Cryptographic operations at rest (AES-256-GCM) and in transit (HMAC-SHA256)
- Immutable audit compliance patterns that survive application-level bugs

No other category of web application exercises this breadth of backend engineering discipline in a single coherent product. A hiring panel evaluating this project sees: schema design, security engineering, async systems, real-time systems, API design, and frontend architecture — simultaneously.

---

## 9. High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          SELADEV Platform                             │
│                                                                       │
│  ┌────────────────────┐     ┌──────────────────────────────────────┐  │
│  │   React SPA        │────▶│       Express.js REST API            │  │
│  │   (Vite + TS)      │     │  Node.js · TypeScript · Clean Arch   │  │
│  │   TanStack Query   │◀────│  JWT Auth Middleware                 │  │
│  │   shadcn/ui        │     │  RBAC Guard Middleware               │  │
│  │   Zustand          │     │  Feature Routers → Service Layer     │  │
│  │   Socket.IO client │     │  Service Layer → Repository Layer    │  │
│  └────────────────────┘     └────────────┬──────────┬─────────────┘  │
│                                          │          │                │
│                               ┌──────────▼──┐  ┌───▼──────────┐     │
│                               │  MongoDB    │  │   Redis      │     │
│                               │  (Mongoose) │  │  BullMQ +    │     │
│                               │  Shared DB  │  │  Socket.IO   │     │
│                               │  Multi-org  │  │  Adapter     │     │
│                               └─────────────┘  └──────────────┘     │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  BullMQ Workers                                                 │  │
│  │  · Deployment Pipeline Worker (status transitions + events)    │  │
│  │  · Webhook Delivery Worker (HMAC sign, send, retry, DLQ)       │  │
│  │  · Email Notification Worker (SMTP/SendGrid templated email)   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Infrastructure (Docker Compose)                                │  │
│  │  · mongo:7          · redis:7          · Node API              │  │
│  │  · Vite dev server  · nginx (prod)     · GitHub Actions CI     │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

For full component boundaries, inter-service data flow, and technology decision rationale, see [`system-design.md`](./system-design.md).

For MongoDB schemas, indexing strategy, and encryption design, see [`database-design.md`](./database-design.md).

For authentication flow, token lifecycle, and RBAC model, see [`auth-design.md`](./auth-design.md).

For REST API conventions, versioning strategy, and error contracts, see [`api-design.md`](./api-design.md).

---

## 10. Success Metrics

SELADEV defines success across three dimensions: **technical quality**, **developer experience**, and **portfolio signal**.

### 10.1 Technical Quality Metrics

| Metric                              | Target                                       |
|-------------------------------------|----------------------------------------------|
| API p99 response latency (reads)    | < 200ms                                      |
| API p99 response latency (writes)   | < 500ms                                      |
| Deployment job queue throughput     | ≥ 50 concurrent jobs without degradation     |
| Secret encryption coverage          | 100% of secret values encrypted at rest      |
| Audit log write failure rate        | 0% — writes are synchronous pre-response     |
| Unit + integration test coverage    | ≥ 80% across backend service layer           |
| E2E test pass rate on main          | 100%                                         |
| TypeScript strict mode violations   | 0 (`"strict": true` in all tsconfigs)        |
| OpenAPI spec completeness           | 100% of endpoints documented                 |

### 10.2 Developer Experience Metrics

| Metric                               | Target                                      |
|--------------------------------------|---------------------------------------------|
| Time to first successful deployment  | < 5 minutes from project creation           |
| Secret retrieval to developer        | Masked by default, reveal in 1 click        |
| Real-time status update latency      | < 500ms from server event to UI update      |
| API key issuance time                | < 2 seconds end-to-end                      |
| New org member fully onboarded       | Fully functional in < 3 minutes             |
| Webhook delivery attempt latency     | < 10 seconds from event trigger             |

### 10.3 Portfolio Signal Metrics

| Metric                                  | Target                                   |
|-----------------------------------------|------------------------------------------|
| Architecture doc coverage               | Every major system has a dedicated doc   |
| Security posture                        | OWASP Top 10 addressed with evidence     |
| Demo scenario coverage                  | All 9 product pillars demonstrable live  |
| README time-to-run                      | Junior engineer running locally in < 10m |
| Code review readiness                   | No TODO/FIXME left in core service paths |

---

*Document version: 1.0.0 — Last updated: June 2026*
*Author: SELADEV Engineering*
*Cross-references: [system-design.md](./system-design.md) · [database-design.md](./database-design.md) · [auth-design.md](./auth-design.md) · [api-design.md](./api-design.md) · [01-prd.md](./01-prd.md) · [02-requirements.md](./02-requirements.md)*
