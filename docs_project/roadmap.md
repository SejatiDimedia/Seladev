# Product & Engineering Roadmap — SELADEV IDP

## Purpose

This document defines the product vision, current state, and phased roadmap for the SELADEV Internal Developer Platform. It is a living document updated with each release cycle.

**Audience:**
- **Engineering team** — understand what to build and in what sequence
- **Product / design** — align on feature scope and dependencies
- **Engineering leadership** — track technical debt, open source strategy, and enterprise readiness

---

## 1. Vision Statement

> *SELADEV becomes the standard Internal Developer Platform for modern engineering teams — the single place where code meets cloud, where secrets are secure, deployments are auditable, and every developer has exactly the access they need.*

**18-month goal (by end of 2027):**

SELADEV is a production-ready, SOC2-compliant SaaS IDP trusted by mid-market engineering organizations (50–500 engineers). It offers:

- A fully self-serve onboarding flow (from sign-up to first deployment in < 10 minutes)
- Real CI/CD integrations with GitHub Actions, GitLab CI, and CircleCI
- Enterprise SSO (SAML/OIDC) with org-level enforcement
- A GraphQL API and SDK for programmatic access
- An analytics dashboard giving engineering managers insight into deployment frequency, change failure rate, and mean time to recovery (DORA metrics)
- A mobile companion app for on-call engineers

The platform is **developer-first**: every feature is evaluated against its DX impact before shipping.

---

## 2. Current State (as of June 21, 2026)

The architecture, documentation, and foundational platform infrastructure are complete. The following design and engineering decisions are locked in:

- **Monorepo** structure (Turborepo + pnpm)
- **Auth architecture** (JWT RS256 + refresh token rotation + RBAC two-tier model)
- **Secret encryption** (AES-256-GCM with per-org derived keys)
- **Async job infrastructure** (BullMQ + Redis)
- **Real-time notification system** (Socket.IO + BullMQ notification queue)
- **Webhook system** (HMAC signing, retry with exponential backoff, dead letter queue)
- **Audit log system** (immutable, append-only, org-scoped)
- **Database design** (MongoDB with encryption-at-rest, indexing strategy, multi-tenant scoping)
- **API design standards** (versioning, error contracts, pagination, OpenAPI docs)
- **Testing strategy** (test pyramid, coverage contracts, Playwright E2E)
- **Observability** (structured logging, health checks, alerting thresholds)

---

## 3. Phase 1 — MVP ✅ COMPLETE

**Target:** Internal use and design partner pilot  
**Status:** ✅ All 9 feature areas implemented, tested, and verified (143 passing tests)  
**Completed:** 2026-06-21

### 3.1 Identity & Access

- [x] User registration and login (email + password)
- [x] JWT RS256 access tokens (15-min lifetime)
- [x] Refresh token rotation with reuse detection
- [x] Access token blocklist via Redis
- [x] Bcrypt password hashing (cost 12) + HaveIBeenPwned check
- [x] Login rate limiting (5 attempts → 15-min lockout)
- [x] Two-tier RBAC: org roles (OWNER, ADMIN, MEMBER, VIEWER) + project roles
- [x] Org membership management (invite, remove, role change)

### 3.2 Project Management

- [x] Org creation and settings
- [x] Project CRUD with org scoping
- [x] Environment management (development, staging, production)
- [x] Project member assignment with project-level roles

### 3.3 Secrets & Configuration

- [x] Encrypted secret storage (AES-256-GCM)
- [x] Per-org key derivation (HKDF from master key)
- [x] Secret CRUD with environment scoping
- [x] Field projection — encrypted value excluded from list responses
- [x] Audit log on every secret access

### 3.4 API Keys

- [x] API key generation (SHA-256 hash storage, prefix display)
- [x] Key scoping to project + action set
- [x] Key expiry and revocation
- [x] API key usage tracking in audit log

### 3.5 Deployments

- [x] Deployment trigger endpoint
- [x] BullMQ-backed simulated deployment pipeline
- [x] Deployment status tracking (QUEUED, RUNNING, SUCCESS, FAILED)
- [x] Real-time status updates via Socket.IO
- [x] Deployment history with pagination

### 3.6 Webhooks

- [x] Webhook registration with URL + event type scoping
- [x] HMAC-SHA256 signing on all deliveries
- [x] SSRF prevention (private IP blocklist + DNS rebinding detection)
- [x] Retry with exponential backoff (3 attempts)
- [x] Dead letter queue for failed deliveries
- [x] Delivery log for debugging

### 3.7 Audit Logs

- [x] Immutable audit log collection (insert-only DB role)
- [x] Structured log entries (actor, action, resource, metadata, IP, userAgent)
- [x] Cursor-paginated list API
- [x] Filtering by actor, action type, date range
- [x] Export endpoint (NDJSON streaming)

### 3.8 Notifications

- [x] Real-time in-app notifications via Socket.IO
- [x] Email notifications via BullMQ + email adapter (nodemailer)
- [x] Notification preferences per user
- [x] Mark as read / mark all as read
- [x] Notification count badge (real-time)

### 3.9 Developer Tooling

- [x] OpenAPI 3.1 spec (auto-generated via `zod-to-openapi`)
- [x] Swagger UI at `/api/docs`
- [x] Health check endpoints (`/health`, `/health/ready`)
- [x] SDK generation scaffold (TypeScript client from OpenAPI spec)
- [x] Environment health check endpoint (validate required env vars)

---

## 4. Phase 2 — v1.1 (Near Term: Q3 2026) ✅ COMPLETE

**Theme:** Security hardening + secret lifecycle management  
**Target:** Design partner beta launch  
**Completed:** 2026-06-22

### 4.1 MFA / TOTP

- [x] TOTP secret generation (RFC 6238, `otplib`)
- [x] QR code enrollment flow
- [x] TOTP verification on login (second factor)
- [x] Backup recovery codes (8 x 10-char codes, bcrypt-hashed)
- [x] Org-level MFA enforcement setting (block login without MFA)
- [x] MFA disable flow (requires TOTP confirmation)
- [x] Audit log: `auth.mfa.enabled`, `auth.mfa.disabled`, `auth.mfa.bypass_used`

**Technical notes:**
- TOTP secret encrypted with AES-256-GCM before storage (see `security.md §5.4`)
- MFA state is a prerequisite for the SSO work in Phase 3

### 4.2 SSO / SAML (OIDC prep)

- [x] SAML 2.0 SP-initiated login flow
- [x] OIDC provider integration (Google Workspace, Microsoft Entra ID)
- [x] Just-in-time (JIT) provisioning (auto-create user + assign org role on first SSO login)
- [x] SSO session management (respect IdP session lifetime)
- [x] Org-level SSO enforcement (disable password login when SSO is active)
- [x] SP metadata endpoint (`/api/v1/auth/sso/metadata`)

**Technical notes:**
- Use `passport-saml` or `samlify` for SAML SP implementation
- Store IdP metadata (Entity ID, SSO URL, cert) encrypted per org
- OIDC state parameter stored in Redis (15-min TTL) to prevent CSRF on callback

### 4.3 Secret Versioning

- [x] Version history on every secret write (immutable version documents)
- [x] `GET /secrets/:id/versions` — list version history
- [x] `POST /secrets/:id/rollback/:versionId` — restore previous value
- [x] Version retention policy (keep last N versions, configurable per org)
- [x] Audit log: `secret.version.restored`

**Schema addition:**
```typescript
interface SecretVersion {
  _id: ObjectId;
  secretId: ObjectId;
  orgId: ObjectId;
  value: EncryptedField;  // AES-256-GCM encrypted
  createdAt: Date;
  createdBy: ObjectId;    // userId
  version: number;        // Monotonic counter
}
```

### 4.4 API Key Environment Scoping

- [x] API keys scoped to specific environments (dev, staging, production)
- [x] Environment filter enforced at secret read: key for `staging` cannot read `production` secrets
- [x] UI: environment scope selector in API key creation flow
- [x] Audit log: `apikey.access.env_violation` on blocked cross-env read

---

## 5. Phase 3 — v1.5 (Mid Term: Q1 2027) 🔄 PARTIALLY COMPLETE

**Theme:** Platform integrations + developer experience  
**Target:** Public beta / GA

### 5.1 Real CI/CD Integration

- [ ] GitHub App installation flow (webhook events from GitHub Actions)
- [ ] GitLab CI integration (Pipeline webhook receiver)
- [ ] CircleCI integration (Webhook receiver)
- [x] Deployment trigger from CI pipeline (SELADEV CLI + API key)
- [x] SELADEV CLI (`npx seladev deploy`, `npx seladev secrets pull`)
- [ ] GitHub Actions OIDC integration (keyless auth for CI deployments)
- [x] Deployment environment promotion (dev → staging → production with approval gate)

**SELADEV CLI (new package: `packages/cli`):**
```bash
npx seladev login                    # OIDC device flow
npx seladev secrets pull --env prod  # Download secrets as .env
npx seladev deploy --project my-app  # Trigger deployment
npx seladev status                   # Check deployment status
```

### 5.2 GraphQL Endpoint ✅ COMPLETE

- [x] GraphQL schema covering projects, secrets, deployments, audit logs
- [x] Query batching (DataLoader pattern for N+1 prevention)
- [x] GraphQL subscriptions for real-time deployment status
- [x] Schema introspection disabled in production
- [x] Depth limiting + complexity analysis (prevent expensive queries)
- [x] Auth: same JWT + RBAC as REST API

**Why GraphQL now (not earlier):**
The REST API must be stable before adding GraphQL. GraphQL is an additive layer — REST remains the primary API. GraphQL serves SDK consumers who need flexible queries.

### 5.3 Analytics Dashboard 🔄 PARTIALLY COMPLETE

- [x] DORA metrics (deployment frequency, lead time, change failure rate, MTTR)
- [x] Deployment success/failure trends (by project, by environment)
- [x] Secret rotation age distribution (flag stale secrets)
- [x] API key usage heatmap
- [x] Team activity timeline
- [ ] Export to CSV / PDF

**Data source:** Aggregate from `deployments` and `audit_logs` collections with a nightly aggregation job into `analytics_snapshots`. Do not run analytics queries live against operational collections.

### 5.4 Team Workspaces ✅ COMPLETE

- [x] Multiple orgs per user (currently 1:1)
- [x] Workspace switcher in UI
- [x] Cross-workspace audit visibility for platform admins
- [ ] Billing tied to workspace (org), not individual user

---

## 6. Phase 4 — v2.0 (Long Term: Q4 2027)

**Theme:** Scale, enterprise, and ecosystem  
**Target:** Enterprise GA

### 6.1 Microservices Extraction

Extract high-load or independently-scalable concerns from the monolith:

```
Current:  api/ (monolith)
Future:
  api-gateway/      — routing, auth verification, rate limiting
  secrets-service/  — encryption/decryption, key management
  deploy-service/   — BullMQ workers for deployments
  notify-service/   — Socket.IO + email delivery
  audit-service/    — immutable audit log writes + queries
```

**Migration strategy:** Strangler Fig — extract one service at a time, using the existing monolith as fallback. Services communicate via internal gRPC or Redis pub/sub. Full microservices extraction is not required for GA; this is an architectural option post-product-market-fit.

### 6.2 Multi-Region Deployment

- [ ] MongoDB Atlas Global Clusters (multi-region writes with zone sharding)
- [ ] Redis Cluster across regions (Redis Sentinel for failover)
- [ ] CDN (Cloudflare) for static assets and API caching at edge
- [ ] Data residency controls (EU data stays in EU)
- [ ] Active-active deployment in US-East + EU-West

### 6.3 Mobile App (iOS + Android)

- [ ] On-call companion app: deployment status, alert acknowledge, secret lookup
- [ ] Biometric auth (FaceID / fingerprint) for secret access
- [ ] Push notifications (via APNs / FCM) for deployment events
- [ ] React Native + Expo (shared codebase with web where possible)

### 6.4 HashiCorp Vault Backend

- [ ] Optional Vault backend for secret storage (replace AES-256-GCM MongoDB storage)
- [ ] Vault namespace per org
- [ ] Vault dynamic secrets for DB credentials (short-lived, auto-rotated)
- [ ] Transit secrets engine for envelope encryption
- [ ] Migration tooling: export from SELADEV → import to Vault

---

## 7. Technical Debt Items

Items deferred from MVP for pragmatic reasons, sourced from "Future Improvements" sections across all design documents:

| Item | Source Doc | Priority | Estimated Effort |
|------|-----------|----------|-----------------|
| OpenTelemetry distributed tracing | monitoring.md | High | 3 days |
| WAF integration (Cloudflare / AWS) | security.md | High | 2 days |
| Penetration testing (3rd party) | security.md | High | External vendor |
| Grafana + Prometheus metrics stack | monitoring.md | High | 5 days |
| CDN for static frontend assets | performance.md | High | 2 days |
| MongoDB Atlas Search for audit logs | performance.md | Medium | 3 days |
| HTTP/2 at load balancer | performance.md | Medium | 1 day |
| Brotli compression | performance.md | Low | 0.5 days |
| SBOM generation in CI | security.md | Medium | 1 day |
| HSM / KMS for master encryption key | security.md | Medium | 5 days |
| mTLS for inter-service communication | security.md | Low | 5 days (post-microservices) |
| WebWorker for client-side crypto | performance.md | Low | 2 days |
| React Server Components | performance.md | Low | 5 days |
| MongoDB Atlas connection pool tuning | performance.md | Medium | 1 day |

---

## 8. Open Source Considerations

### 8.1 What to Open Source

| Component | OSS Candidate | Rationale |
|-----------|--------------|-----------|
| Core platform (MIT) | Yes | Drive adoption; competitors are primarily closed-source |
| SELADEV CLI | Yes | Ecosystem tooling benefits from community contributions |
| OpenAPI spec | Yes | SDK generation by community |
| Helm charts | Yes | Kubernetes deployment configs — community improves them |
| Terraform provider | Yes | IaC users need a provider |

### 8.2 What Remains Closed

| Component | Closed | Rationale |
|-----------|--------|-----------|
| Enterprise SSO config UI | Closed | Differentiator for Enterprise tier |
| Analytics aggregation engine | Closed | DORA metrics are a premium feature |
| Multi-region deployment configs | Closed | Infrastructure-specific; security risk to expose |
| Billing / usage metering | Closed | Business logic |

### 8.3 Open Source Readiness Checklist

Before OSS launch:
- [ ] License header on all source files (`MIT`)
- [ ] `CONTRIBUTING.md` published (see `/CONTRIBUTING.md`)
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [ ] `SECURITY.md` with responsible disclosure policy
- [ ] No hardcoded secrets or internal infra references in codebase
- [ ] `.env.example` with all required variables documented
- [ ] `CHANGELOG.md` kept up to date (see `/CHANGELOG.md`)
- [ ] Issue templates (bug report, feature request)
- [ ] PR template
- [ ] GitHub Actions CI runs on fork PRs

---

## 9. Enterprise Readiness Checklist

Items required before targeting Enterprise customers:

### Security & Compliance
- [ ] SOC2 Type II audit complete
- [ ] Penetration test report < 6 months old
- [ ] Data Processing Agreement (DPA) template
- [ ] Privacy Policy and Terms of Service
- [ ] GDPR / CCPA controls (data export, right to deletion)
- [ ] Data residency controls (EU region option)

### Identity & Access
- [ ] SAML 2.0 SSO
- [ ] SCIM provisioning (auto-sync users from IdP)
- [ ] MFA enforcement at org level
- [ ] IP allowlisting for org access
- [ ] Granular permission model (custom roles)

### Reliability
- [ ] 99.9% uptime SLA (contractual)
- [ ] Multi-region deployment
- [ ] RTO < 1 hour, RPO < 5 minutes
- [ ] Disaster recovery runbook tested quarterly
- [ ] Status page (statuspage.io or equivalent)

### Operations
- [ ] 24/7 on-call rotation
- [ ] Incident response SLA (P0: 15 min, P1: 2 hr)
- [ ] Security vulnerability disclosure SLA (Critical: 24hr patch)
- [ ] Customer support SLA (Enterprise: 4hr response)

### Commercial
- [ ] Volume-based pricing tiers
- [ ] Self-hosted deployment option (Docker Compose + Helm chart)
- [ ] Enterprise license agreement
- [ ] Dedicated CSM for accounts > $100K ARR

---

*Document version: 1.1 | Last updated: 2026-06-21 | Owner: Product & Engineering Leadership*  
*Phase 1 MVP marked complete — all 9 backend feature areas shipped with full test coverage.*
