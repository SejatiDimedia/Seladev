# SELADEV — Internal Developer Platform

> **The Unified Developer Platform to Bridge Your Code and Cloud Deployment.**

[![Platform](https://img.shields.io/badge/Platform-Internal%20Developer%20Platform-6366f1?style=flat-square)](https://seladev.dev)
[![Stack](https://img.shields.io/badge/Stack-MERN%20%2B%20TypeScript-3178c6?style=flat-square)]()
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)]()

---

## Table of Contents

- [Brand](#brand)
- [Project Overview](#project-overview)
- [Architecture Summary](#architecture-summary)
- [Documentation Index](#documentation-index)
- [Quick Start](#quick-start)
- [Repository Structure](#repository-structure)
- [Engineering Standards](#engineering-standards)
- [Contributing](#contributing)

---

## Brand

| | |
|---|---|
| **Brand Name** | SELADEV |
| **Phonetic** | Se · la · dev |
| **Tagline** | *"The Unified Developer Platform to Bridge Your Code and Cloud Deployment."* |
| **Domain** | [seladev.dev](https://seladev.dev) · [seladev.com](https://seladev.com) |
| **Positioning** | Modern web-based Internal Developer Platform (IDP) focused on minimalism, orchestration speed, and superior Developer Experience (DX). |

---

## Project Overview

The IDP is an internal developer platform targeting engineering teams who need centralized governance over their software delivery lifecycle. It provides:

| Domain | Capabilities |
|---|---|
| **Identity & Access** | JWT auth, refresh token rotation, RBAC with org/project scoping |
| **Project Management** | Projects, environments, members, role assignments |
| **Secrets & Config** | Encrypted secret storage, environment variable management |
| **API Keys** | Scoped API key issuance, rotation, expiry |
| **Deployments** | Simulated deployment pipeline with status tracking |
| **Webhooks** | Event-driven webhook delivery with retry and logging |
| **Audit Logs** | Immutable audit trail with actor, resource, and event metadata |
| **Notifications** | Real-time in-app + email notification delivery |
| **Analytics** | Usage metrics, deployment frequency, error rates |
| **Developer Tooling** | OpenAPI docs, SDK generation, environment health checks |

**This is not a tutorial project.** Architecture decisions reflect the constraints and tradeoffs of a real enterprise SaaS product.

---

## Architecture Summary

```
┌──────────────────────────────────────────────────────┐
│                    React Frontend                     │
│          (Vite · TypeScript · TailwindCSS)            │
│        TanStack Query · Zustand · shadcn/ui           │
└─────────────────────┬────────────────────────────────┘
                      │ HTTPS / WebSocket
┌─────────────────────▼────────────────────────────────┐
│                  Express API Server                   │
│             (Node.js · TypeScript · JWT)              │
│           Feature-based · Clean Architecture          │
└──────┬──────────────┬────────────────┬───────────────┘
       │              │                │
┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
│   MongoDB   │ │   Redis    │ │   BullMQ    │
│  Mongoose   │ │  Cache /   │ │  Job Queue  │
│  Documents  │ │  Sessions  │ │  Workers    │
└─────────────┘ └────────────┘ └─────────────┘
                                      │
                               ┌──────▼──────┐
                               │  Socket.IO  │
                               │  Real-time  │
                               └─────────────┘
```

**Key architectural decisions:**

- **MERN stack** chosen for full TypeScript coverage across frontend and backend, shared types, and ecosystem maturity for rapid iteration.
- **Feature-based folder structure** over layer-based (controllers/services/models) to enforce bounded contexts and make the codebase navigable at scale.
- **Clean Architecture with Repository Pattern** to decouple business logic from MongoDB, enabling future database changes without cascading rewrites.
- **BullMQ over direct processing** for webhook delivery and notification dispatch — decouples request/response cycle from I/O-intensive side effects.
- **Redis for session tracking and rate limiting** — not as a primary data store. MongoDB remains the source of truth.

---

## Documentation Index

| Document | Purpose |
|---|---|
| [`docs/architecture/system-design.md`](docs/architecture/system-design.md) | System design, component boundaries, data flow |
| [`docs/architecture/database-design.md`](docs/architecture/database-design.md) | MongoDB schema design, indexing strategy, data modeling decisions |
| [`docs/architecture/api-design.md`](docs/architecture/api-design.md) | REST API conventions, versioning, error contracts |
| [`docs/architecture/auth-design.md`](docs/architecture/auth-design.md) | JWT + refresh token strategy, RBAC model |
| [`docs/architecture/frontend-architecture.md`](docs/architecture/frontend-architecture.md) | Frontend structure, state management, data fetching |
| [`docs/architecture/queue-design.md`](docs/architecture/queue-design.md) | BullMQ job architecture, retry strategy, dead letter handling |
| [`docs/engineering/folder-structure.md`](docs/engineering/folder-structure.md) | Annotated monorepo structure with rationale |
| [`docs/engineering/coding-standards.md`](docs/engineering/coding-standards.md) | TypeScript conventions, patterns, and anti-patterns |
| [`docs/engineering/testing-strategy.md`](docs/engineering/testing-strategy.md) | Test pyramid, tooling, coverage contracts |
| [`docs/engineering/error-handling.md`](docs/engineering/error-handling.md) | Error classification, response contracts, observability |
| [`docs/devops/docker-setup.md`](docs/devops/docker-setup.md) | Docker Compose, container strategy, local dev |
| [`docs/devops/ci-cd.md`](docs/devops/ci-cd.md) | GitHub Actions pipeline design |
| [`docs/devops/environment-config.md`](docs/devops/environment-config.md) | Environment variables, secrets management |
| [`docs/features/secrets.md`](docs/features/secrets.md) | Secret storage design, encryption approach |
| [`docs/features/webhooks.md`](docs/features/webhooks.md) | Webhook delivery, signing, retry logic |
| [`docs/features/audit-logs.md`](docs/features/audit-logs.md) | Audit log schema, immutability, querying |
| [`docs/features/rbac.md`](docs/features/rbac.md) | Role definitions, permission matrix, enforcement |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- pnpm 9+

### Local Development

```bash
# Clone and install
git clone https://github.com/your-org/idp.git
cd idp
pnpm install

# Start infrastructure (MongoDB, Redis)
docker compose up -d mongo redis

# Set up environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Run database migrations and seed
pnpm --filter api db:migrate
pnpm --filter api db:seed

# Start development servers
pnpm dev
```

The API will be available at `http://localhost:4000` and the web app at `http://localhost:5173`.

### Full Stack with Docker

```bash
docker compose --profile full up
```

---

## Repository Structure

```
idp/
├── apps/
│   ├── api/              # Express API server
│   └── web/              # React frontend
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── utils/            # Shared utility functions
│   └── validators/       # Shared Zod schemas
├── docs/                 # Engineering documentation
├── docker/               # Dockerfiles and compose configs
├── .github/
│   └── workflows/        # CI/CD pipelines
├── docker-compose.yml
├── pnpm-workspace.yaml
└── turbo.json
```

This is a **pnpm monorepo** managed with Turborepo. The `packages/` directory contains shared code between `apps/api` and `apps/web`, enforcing a single source of truth for validation schemas, TypeScript types, and utilities.

---

## Engineering Standards

- **All code is TypeScript.** No implicit `any`. Strict mode enabled.
- **All API routes have Zod validation** on request bodies, query params, and path params.
- **All business logic lives in the service layer.** Controllers are thin — they parse, delegate, and respond.
- **All database access goes through repositories.** No direct Mongoose calls in controllers or services.
- **All public API changes require an OpenAPI spec update.**
- **All features require unit tests.** Integration tests required for critical paths.
- **No secrets in code or commit history.** Environment variables only.

See [`docs/engineering/coding-standards.md`](docs/engineering/coding-standards.md) for the full standards document.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch naming, PR templates, commit conventions, and review guidelines.

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced via commitlint.# Seladev
