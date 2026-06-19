# Folder Structure

**Document Type:** Engineering Reference  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the canonical folder structure for the IDP monorepo. Every directory has an explicit purpose. This is the reference for onboarding engineers and for resolving "where does this code go?" questions. When in doubt, consult this document before creating a new directory.

---

## Design Principles

The folder structure follows **feature-based organization** rather than layer-based organization.

**Layer-based (rejected):**
```
src/
├── controllers/
├── services/
├── models/
├── middlewares/
└── routes/
```

This structure becomes unmaintainable past ~10 features because adding or removing a feature requires touching 5+ directories. Understanding "what does the Secrets feature do?" requires navigating across every layer directory.

**Feature-based (chosen):**
```
src/
├── features/
│   ├── secrets/
│   │   ├── secrets.controller.ts
│   │   ├── secrets.service.ts
│   │   ├── secrets.repository.ts
│   │   ├── secrets.routes.ts
│   │   └── secrets.schema.ts
│   └── ...
```

Each feature is a self-contained vertical slice. Adding, removing, or understanding a feature is bounded to one directory.

---

## Monorepo Root

```
idp/
├── apps/
│   ├── api/                    # Express API server
│   └── web/                    # React SPA
│
├── packages/
│   ├── types/                  # Shared TypeScript interfaces
│   ├── validators/             # Shared Zod schemas
│   └── utils/                  # Shared pure utility functions
│
├── docker/
│   ├── api.Dockerfile
│   ├── web.Dockerfile
│   └── worker.Dockerfile
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy-staging.yml
│       └── deploy-production.yml
│
├── docs/                       # Engineering documentation (this directory)
│
├── docker-compose.yml          # Full local stack
├── docker-compose.dev.yml      # Dev overrides (hot reload, port exposure)
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo pipeline config
├── .eslintrc.base.js           # Shared ESLint config
├── tsconfig.base.json          # Shared TypeScript config
└── README.md
```

---

## API Application (`apps/api/`)

```
apps/api/
├── src/
│   ├── app.ts                  # Express app factory (no listen call)
│   ├── server.ts               # Entry point: creates app, starts server
│   │
│   ├── config/
│   │   ├── index.ts            # Validated config object (zod-parsed env vars)
│   │   ├── database.ts         # Mongoose connection setup
│   │   ├── redis.ts            # Redis client setup
│   │   └── socket.ts           # Socket.IO server setup
│   │
│   ├── features/               # Feature vertical slices (primary code location)
│   │   │
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.repository.ts   # refreshTokens collection access
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.schema.ts       # Zod request schemas
│   │   │   └── auth.types.ts
│   │   │
│   │   ├── organizations/
│   │   │   ├── organizations.controller.ts
│   │   │   ├── organizations.service.ts
│   │   │   ├── organizations.repository.ts
│   │   │   ├── organizations.routes.ts
│   │   │   ├── organizations.schema.ts
│   │   │   └── organizations.types.ts
│   │   │
│   │   ├── projects/
│   │   │   ├── projects.controller.ts
│   │   │   ├── projects.service.ts
│   │   │   ├── projects.repository.ts
│   │   │   ├── projects.routes.ts
│   │   │   ├── projects.schema.ts
│   │   │   └── projects.types.ts
│   │   │
│   │   ├── environments/
│   │   │   ├── environments.controller.ts
│   │   │   ├── environments.service.ts
│   │   │   ├── environments.repository.ts
│   │   │   ├── environments.routes.ts
│   │   │   ├── environments.schema.ts
│   │   │   └── environments.types.ts
│   │   │
│   │   ├── secrets/
│   │   │   ├── secrets.controller.ts
│   │   │   ├── secrets.service.ts
│   │   │   ├── secrets.repository.ts
│   │   │   ├── secrets.routes.ts
│   │   │   ├── secrets.schema.ts
│   │   │   ├── secrets.encryption.ts  # AES-256-GCM encrypt/decrypt
│   │   │   └── secrets.types.ts
│   │   │
│   │   ├── api-keys/
│   │   │   ├── api-keys.controller.ts
│   │   │   ├── api-keys.service.ts
│   │   │   ├── api-keys.repository.ts
│   │   │   ├── api-keys.routes.ts
│   │   │   ├── api-keys.schema.ts
│   │   │   └── api-keys.types.ts
│   │   │
│   │   ├── deployments/
│   │   │   ├── deployments.controller.ts
│   │   │   ├── deployments.service.ts
│   │   │   ├── deployments.repository.ts
│   │   │   ├── deployments.routes.ts
│   │   │   ├── deployments.schema.ts
│   │   │   ├── deployments.simulator.ts  # Simulated pipeline state machine
│   │   │   └── deployments.types.ts
│   │   │
│   │   ├── webhooks/
│   │   │   ├── webhooks.controller.ts
│   │   │   ├── webhooks.service.ts
│   │   │   ├── webhooks.repository.ts
│   │   │   ├── webhooks.routes.ts
│   │   │   ├── webhooks.schema.ts
│   │   │   └── webhooks.types.ts
│   │   │
│   │   ├── audit-logs/
│   │   │   ├── audit-logs.controller.ts
│   │   │   ├── audit-logs.service.ts     # AuditLogService.record(event)
│   │   │   ├── audit-logs.repository.ts
│   │   │   ├── audit-logs.routes.ts
│   │   │   ├── audit-logs.schema.ts
│   │   │   └── audit-logs.types.ts
│   │   │
│   │   ├── notifications/
│   │   │   ├── notifications.controller.ts
│   │   │   ├── notifications.service.ts
│   │   │   ├── notifications.repository.ts
│   │   │   ├── notifications.routes.ts
│   │   │   └── notifications.types.ts
│   │   │
│   │   ├── members/
│   │   │   ├── members.controller.ts
│   │   │   ├── members.service.ts
│   │   │   ├── members.repository.ts    # memberships + projectMembers
│   │   │   ├── members.routes.ts
│   │   │   ├── members.schema.ts
│   │   │   └── members.types.ts
│   │   │
│   │   └── analytics/
│   │       ├── analytics.controller.ts
│   │       ├── analytics.service.ts     # MongoDB aggregation pipelines
│   │       ├── analytics.routes.ts
│   │       └── analytics.types.ts
│   │
│   ├── infrastructure/          # Cross-cutting infrastructure
│   │   │
│   │   ├── database/
│   │   │   ├── base.repository.ts      # Abstract base with org-scoped queries
│   │   │   └── models/                 # Mongoose models
│   │   │       ├── organization.model.ts
│   │   │       ├── user.model.ts
│   │   │       ├── membership.model.ts
│   │   │       ├── project.model.ts
│   │   │       ├── project-member.model.ts
│   │   │       ├── environment.model.ts
│   │   │       ├── secret.model.ts
│   │   │       ├── api-key.model.ts
│   │   │       ├── deployment.model.ts
│   │   │       ├── webhook.model.ts
│   │   │       ├── webhook-delivery.model.ts
│   │   │       ├── audit-log.model.ts
│   │   │       ├── notification.model.ts
│   │   │       └── refresh-token.model.ts
│   │   │
│   │   ├── queue/
│   │   │   ├── queue.client.ts         # BullMQ queue instances
│   │   │   ├── workers/
│   │   │   │   ├── webhook.worker.ts
│   │   │   │   ├── notification.worker.ts
│   │   │   │   ├── email.worker.ts
│   │   │   │   └── deployment.worker.ts
│   │   │   └── jobs/
│   │   │       ├── webhook.job.ts      # Job data types
│   │   │       ├── notification.job.ts
│   │   │       └── deployment.job.ts
│   │   │
│   │   ├── cache/
│   │   │   ├── cache.service.ts        # Redis get/set/del with namespacing
│   │   │   └── rbac.cache.ts           # Membership cache helpers
│   │   │
│   │   └── events/
│   │       └── event-bus.ts            # Internal Node.js EventEmitter bus
│   │
│   ├── middleware/              # Express middleware (shared across features)
│   │   ├── authenticate-jwt.ts
│   │   ├── authenticate-api-key.ts
│   │   ├── authorize-rbac.ts
│   │   ├── validate-request.ts         # Zod middleware factory
│   │   ├── rate-limit.ts
│   │   ├── request-id.ts
│   │   ├── request-logger.ts
│   │   ├── error-handler.ts            # Global error handler middleware
│   │   └── not-found.ts
│   │
│   ├── lib/                     # Pure utilities with no Express dependency
│   │   ├── crypto.ts            # Token generation, hashing, encryption helpers
│   │   ├── jwt.ts               # Sign, verify, decode helpers
│   │   ├── pagination.ts        # Offset + cursor pagination builders
│   │   ├── slug.ts              # Slugification with collision detection
│   │   └── errors.ts            # Error class hierarchy
│   │
│   └── types/                   # API-specific TypeScript types
│       ├── express.d.ts         # Augmented Request type (req.user, req.apiKey)
│       └── environment.d.ts     # process.env type augmentation
│
├── tests/
│   ├── unit/                   # Unit tests (mirrors src/ structure)
│   │   ├── features/
│   │   │   ├── secrets/
│   │   │   │   ├── secrets.service.test.ts
│   │   │   │   └── secrets.encryption.test.ts
│   │   │   └── ...
│   │   └── lib/
│   │       └── crypto.test.ts
│   │
│   ├── integration/            # Integration tests (hit real DB)
│   │   ├── auth.test.ts
│   │   ├── projects.test.ts
│   │   ├── secrets.test.ts
│   │   └── deployments.test.ts
│   │
│   └── helpers/
│       ├── db.ts               # Test DB setup/teardown
│       ├── factories.ts        # Test data factories
│       └── request.ts          # Supertest request builder with auth
│
├── .env.example
├── jest.config.ts
├── tsconfig.json
└── package.json
```

---

## Web Application (`apps/web/src/`)

```
apps/web/src/
├── app/
│   ├── App.tsx                 # Root component, route rendering
│   ├── router.tsx              # Route definitions
│   └── providers.tsx           # QueryClientProvider, ThemeProvider, SocketProvider
│
├── features/                   # One directory per product feature
│   ├── auth/
│   │   ├── components/
│   │   │   ├── LoginForm.tsx
│   │   │   ├── RegisterForm.tsx
│   │   │   └── MfaForm.tsx
│   │   ├── hooks/
│   │   │   ├── useLogin.ts
│   │   │   └── useCurrentUser.ts
│   │   ├── api/
│   │   │   ├── auth.api.ts     # API call functions
│   │   │   └── auth.keys.ts    # TanStack Query key factory
│   │   ├── stores/
│   │   │   └── auth.store.ts   # Zustand: accessToken, userId
│   │   └── types.ts
│   │
│   ├── projects/               # (same structure as auth/)
│   ├── environments/
│   ├── secrets/
│   ├── deployments/
│   ├── webhooks/
│   ├── api-keys/
│   ├── audit-logs/
│   ├── members/
│   ├── notifications/
│   └── analytics/
│
├── components/
│   ├── ui/                     # shadcn/ui components (owned source)
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── table.tsx
│   │   ├── badge.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── toast.tsx
│   │   └── ...
│   │
│   ├── layout/
│   │   ├── AppShell.tsx        # Sidebar + header wrapper
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── PageHeader.tsx      # Title, breadcrumb, actions slot
│   │   └── AuthLayout.tsx      # Centered card layout for auth pages
│   │
│   ├── data-display/
│   │   ├── DataTable.tsx       # TanStack Table wrapper with sorting/pagination
│   │   ├── StatusBadge.tsx     # Deployment/webhook status colors
│   │   ├── CopyButton.tsx      # Copy-to-clipboard with feedback
│   │   ├── RelativeTime.tsx    # "2 minutes ago" time display
│   │   ├── CodeBlock.tsx       # Monospace code display with copy
│   │   └── EmptyState.tsx      # Empty list placeholder with CTA
│   │
│   ├── feedback/
│   │   ├── ConfirmDialog.tsx   # Destructive action confirmation
│   │   ├── ErrorBoundary.tsx
│   │   ├── PageLoader.tsx
│   │   └── Skeleton.tsx        # Feature-agnostic loading skeletons
│   │
│   └── forms/
│       ├── FieldWrapper.tsx    # Label + input + error message
│       ├── SecretInput.tsx     # Password-style input with reveal toggle
│       ├── SlugInput.tsx       # Auto-generates slug from name field
│       └── TagInput.tsx        # Multi-value tag entry
│
├── hooks/
│   ├── useDebounce.ts
│   ├── useLocalStorage.ts
│   ├── usePermission.ts        # RBAC check hook
│   ├── useWebSocket.ts         # Socket.IO event subscription
│   └── useQueryParams.ts       # Type-safe URL query param management
│
├── lib/
│   ├── api-client.ts           # Axios instance with interceptors
│   ├── query-client.ts         # TanStack QueryClient configuration
│   ├── socket.ts               # Socket.IO client
│   └── utils.ts                # cn(), formatDate(), truncate()
│
├── stores/
│   ├── auth.store.ts           # accessToken (in-memory), userId
│   ├── org.store.ts            # activeOrgId, org switcher
│   ├── notifications.store.ts  # unreadCount
│   └── ui.store.ts             # sidebarOpen, theme
│
├── pages/                      # Route-level page components (thin wrappers)
│   ├── DashboardPage.tsx
│   ├── ProjectsPage.tsx
│   ├── ProjectDetailPage.tsx
│   ├── SecretsPage.tsx
│   ├── DeploymentsPage.tsx
│   ├── WebhooksPage.tsx
│   ├── AuditLogsPage.tsx
│   ├── ApiKeysPage.tsx
│   ├── MembersPage.tsx
│   ├── AnalyticsPage.tsx
│   └── NotificationsPage.tsx
│
└── types/
    ├── api.types.ts
    └── rbac.types.ts
```

---

## Shared Packages (`packages/`)

### `packages/types/`

```
packages/types/src/
├── index.ts
├── organization.types.ts
├── user.types.ts
├── project.types.ts
├── environment.types.ts
├── secret.types.ts
├── deployment.types.ts
├── webhook.types.ts
├── audit-log.types.ts
├── api-key.types.ts
├── notification.types.ts
└── rbac.types.ts
```

These are pure TypeScript interfaces shared between API responses and frontend expectations. No runtime code. No library dependencies. If the API returns `Project`, the frontend's `Project` type is the same import.

### `packages/validators/`

```
packages/validators/src/
├── index.ts
├── auth.schemas.ts          # LoginSchema, RegisterSchema
├── project.schemas.ts       # CreateProjectSchema, UpdateProjectSchema
├── environment.schemas.ts
├── secret.schemas.ts
├── webhook.schemas.ts
├── deployment.schemas.ts
├── member.schemas.ts
└── api-key.schemas.ts
```

Zod schemas shared between the API (server-side request validation) and frontend (React Hook Form resolver). One schema, one source of truth for validation rules.

### `packages/utils/`

```
packages/utils/src/
├── index.ts
├── format.ts           # formatBytes, formatDuration, formatDate
├── string.ts           # slugify, truncate, maskSecret
├── array.ts            # groupBy, uniqueBy, sortBy
└── constants.ts        # PLAN_LIMITS, DEFAULT_SCOPES, EVENT_TYPES
```

Pure functions only. No React, no Express, no Node.js-specific APIs. These can run in any environment.

---

## Rules Reference

| Rule | Enforcement |
|---|---|
| Features import from shared components, not from other features | ESLint `no-restricted-imports` |
| No direct Mongoose calls outside repositories | Code review + architecture linting |
| No business logic in controllers | Code review |
| No API calls in Zustand stores (server state → TanStack Query) | Code review |
| All `process.env` access through `config/index.ts` | ESLint `no-process-env` |
| All test files co-located under `tests/` with mirrored structure | Jest config `rootDir` |
| Shared code must live in `packages/` | pnpm workspace dependency rules |