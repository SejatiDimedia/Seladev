# Contributing to SELADEV

Thank you for your interest in contributing to SELADEV — the Unified Developer Platform to Bridge Your Code and Cloud Deployment. Whether you are fixing a typo in the docs, squashing a bug, or proposing a new feature, your contribution is valued.

This guide covers everything you need to get from "I want to contribute" to "my PR is merged" efficiently. Please read it thoroughly before opening a pull request — it will save everyone time.

---

## Code of Conduct

SELADEV is committed to providing a welcoming and inclusive environment. All contributors are expected to adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md). Violations may result in removal from the project.

---

## Getting Started

### 1. Fork and Clone

```bash
# Fork via GitHub UI, then clone your fork
git clone https://github.com/<your-username>/seladev.git
cd seladev

# Add upstream remote
git remote add upstream https://github.com/seladev/seladev.git
git fetch upstream
```

### 2. Install Dependencies

SELADEV uses **pnpm** as the package manager and **Turborepo** for monorepo task orchestration. Do not use `npm` or `yarn`.

```bash
# Install pnpm (if not already installed)
npm install -g pnpm

# Install all workspace dependencies
pnpm install

# Install git hooks (husky)
pnpm prepare
```

### 3. Configure Environment

Copy the example environment files and fill in local values:

```bash
# API server environment
cp apps/api/.env.example apps/api/.env

# Web app environment
cp apps/web/.env.example apps/web/.env
```

**Required variables for local development:**

| Variable | Where | Description |
|----------|-------|-------------|
| `MONGODB_URI` | `apps/api/.env` | Local MongoDB connection string |
| `REDIS_URL` | `apps/api/.env` | Local Redis connection string |
| `JWT_PRIVATE_KEY` | `apps/api/.env` | RS256 private key (generate with script) |
| `JWT_PUBLIC_KEY` | `apps/api/.env` | RS256 public key |
| `ENCRYPTION_MASTER_KEY` | `apps/api/.env` | 64-char hex string (32 bytes) |
| `VITE_API_BASE_URL` | `apps/web/.env` | `http://localhost:3001` |

**Generate keys for local development:**
```bash
# Generate RS256 key pair
pnpm --filter api generate:keys

# Generate a random 32-byte encryption master key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Start Local Infrastructure

Start MongoDB and Redis using Docker Compose:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Services started:
- MongoDB on `mongodb://localhost:27017/seladev_dev`
- Redis on `redis://localhost:6379`
- BullMQ Board (queue dashboard) on `http://localhost:3002/queues`

### 5. Run the Development Servers

```bash
# Start all apps in dev mode (API + Web + Workers)
pnpm dev

# Or run individually
pnpm --filter api dev       # Express API on :3001
pnpm --filter web dev       # Vite + React on :5173
pnpm --filter worker dev    # BullMQ workers
```

### 6. Verify Setup

```bash
# Run all tests to verify your setup is correct
pnpm test

# Run the API health check
curl http://localhost:3001/health
# Expected: { "status": "ok", ... }
```

---

## Branch Naming Convention

Branch names must follow the format: `<type>/<short-description>`

| Type | Use For | Example |
|------|---------|---------|
| `feat/` | New features | `feat/totp-mfa` |
| `fix/` | Bug fixes | `fix/refresh-token-reuse-detection` |
| `chore/` | Maintenance, config changes | `chore/update-eslint-config` |
| `docs/` | Documentation only | `docs/add-webhook-examples` |
| `refactor/` | Code restructuring (no behavior change) | `refactor/extract-rbac-middleware` |
| `test/` | Adding or updating tests | `test/integration-secrets-endpoint` |
| `perf/` | Performance improvements | `perf/add-rbac-redis-cache` |
| `ci/` | CI/CD pipeline changes | `ci/add-load-test-step` |

**Rules:**
- Use kebab-case in the description
- Keep descriptions short (3–5 words)
- Reference the issue number where applicable: `feat/totp-mfa-#42`
- Never commit directly to `main` or `develop` — all changes go through PRs

```bash
# Good branch names
feat/secret-versioning
fix/cors-header-missing
docs/update-auth-design
refactor/repository-base-class
test/audit-log-export

# Bad branch names
my-changes
feature
fix_stuff
timur/new-feature  # Don't use your name — use type prefix
```

---

## Commit Convention

SELADEV enforces **Conventional Commits** via `commitlint`. Non-conforming commits are rejected by the pre-commit hook.

### Commit Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type | When to Use |
|------|-------------|
| `feat` | A new feature (triggers minor version bump) |
| `fix` | A bug fix (triggers patch version bump) |
| `docs` | Documentation changes only |
| `style` | Formatting, whitespace — no logic change |
| `refactor` | Code restructuring without behavior change |
| `test` | Adding or correcting tests |
| `chore` | Maintenance: dependency updates, config, scripts |
| `perf` | Performance improvements |
| `ci` | Changes to CI/CD configuration |
| `build` | Changes to build system or external dependencies |

### Scope Examples

| Scope | Covers |
|-------|--------|
| `(auth)` | Authentication, JWT, refresh tokens, RBAC middleware |
| `(secrets)` | Secret storage, encryption, versioning |
| `(api)` | Express routes, error handling, middleware |
| `(web)` | React frontend, components, pages |
| `(worker)` | BullMQ workers and job processors |
| `(docker)` | Dockerfile, docker-compose files |
| `(deps)` | Dependency version updates |
| `(audit)` | Audit log system |
| `(webhook)` | Webhook delivery, signing, retry |
| `(notify)` | Notification system (Socket.IO + email) |
| `(deploy)` | Deployment pipeline feature |
| `(ci)` | GitHub Actions workflows |

### Commit Examples

```bash
# Feature
feat(auth): add TOTP MFA enrollment endpoint

# Bug fix
fix(secrets): prevent encrypted value from appearing in list response

# Documentation
docs(api): add cursor pagination examples to secret list endpoint

# Refactor
refactor(auth): extract token blocklist logic into RedisBlocklistService

# Test
test(webhook): add integration tests for HMAC signature verification

# Chore
chore(deps): upgrade mongoose to 8.4.0

# Performance
perf(secrets): add orgId+environment compound index for faster queries

# Breaking change (note the BREAKING CHANGE footer)
feat(api)!: remove /v0 endpoints

BREAKING CHANGE: The /api/v0 prefix is removed. Migrate all clients to /api/v1.
See the migration guide: docs_project/api-design.md#versioning
```

### Breaking Changes

Breaking changes must be indicated with either:
1. `!` after the type/scope: `feat(api)!: remove legacy endpoint`
2. `BREAKING CHANGE:` footer in the commit body

Any commit with a breaking change triggers a **major version bump** and must include a migration path in the PR description.

---

## Development Workflow

Step-by-step for a typical contribution:

```bash
# 1. Sync your fork with upstream
git fetch upstream
git checkout main
git merge upstream/main

# 2. Create your branch
git checkout -b feat/my-feature

# 3. Make changes
#    → Write the feature/fix
#    → Write tests (required — see Testing Requirements)
#    → Update documentation if needed (see Documentation Requirements)

# 4. Run checks locally before pushing
pnpm lint          # ESLint + TypeScript type check
pnpm test          # Unit + integration tests
pnpm test:e2e      # Playwright E2E (if UI changes)
pnpm build         # Ensure no build errors

# 5. Commit (commitlint hook runs automatically)
git add -A
git commit -m "feat(secrets): add secret versioning endpoint"

# 6. Push and open PR
git push origin feat/my-feature
# → Open PR on GitHub via the URL printed in terminal
```

---

## Pull Request Requirements

### PR Title

The PR title must follow Conventional Commits format exactly (the same as commit messages). It becomes the squash-merge commit message:

```
feat(auth): add TOTP MFA enrollment and verification
fix(webhook): retry delivery on 5xx response from consumer
docs(contributing): add branch naming examples
```

### PR Description Template

When opening a PR, the following template is pre-filled. All sections are required:

```markdown
## What
Brief description of the change. What does this PR add, fix, or change?

## Why
Why is this change needed? Link to the issue or describe the problem.
Closes #<issue-number>

## How
How was this implemented? Key design decisions made and alternatives considered.

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated (for new endpoints)
- [ ] E2E tests added/updated (for UI changes)
- [ ] Manually tested on local environment

## Screenshots / Demo
(Required for UI changes — attach before/after screenshots or a screen recording)

## Checklist
- [ ] PR title follows Conventional Commits
- [ ] Branch is up to date with `develop`
- [ ] All CI checks pass
- [ ] Coverage thresholds pass
- [ ] Relevant documentation updated
- [ ] No secrets or credentials committed
```

### CI Requirements (All Must Pass)

| Check | What It Does |
|-------|-------------|
| `lint` | ESLint + TypeScript `tsc --noEmit` |
| `test:unit` | Vitest unit tests (all packages) |
| `test:integration` | Jest + Supertest integration tests |
| `test:e2e` | Playwright E2E tests (on main user flows) |
| `coverage` | Coverage thresholds (see `testing-strategy.md`) |
| `build` | `turbo build` — all packages must build cleanly |
| `audit` | `pnpm audit --audit-level=high` |
| `bundle-size` | Frontend bundle must not exceed budget |

PRs with failing CI checks are not reviewed until the checks pass. Do not ask reviewers to look at a PR with red CI.

### Coverage Thresholds

| Package | Statements | Branches | Functions |
|---------|-----------|---------|----------|
| `apps/api` | 80% | 75% | 80% |
| `packages/shared` | 90% | 85% | 90% |
| `apps/web` | 70% | 65% | 70% |

Coverage is enforced by Vitest/Jest configuration. A PR that drops coverage below threshold fails CI.

### Reviewer Approval

- All PRs require **at least 1 approval** from a project maintainer
- PRs modifying auth, encryption, or security-critical code require **2 approvals** (one must be a security reviewer)
- PRs touching only documentation require 1 approval from any maintainer
- Self-approval is not permitted
- Stale approvals are dismissed when new commits are pushed

---

## Code Review Guidelines

### For Authors

- Keep PRs **focused and small**. A PR that changes 10 files is easier to review than one that changes 50. If your feature is large, break it into a logical sequence of smaller PRs.
- Respond to all review comments before requesting re-review
- Mark threads as resolved after addressing the comment
- If you disagree with a comment, discuss it — don't silently ignore it

### For Reviewers

**What to look for:**

1. **Correctness** — Does it do what the PR says it does?
2. **Security** — Does it introduce new attack surface? (SQL injection, missing auth check, secrets in logs)
3. **Performance** — Does it add unnecessary DB queries? N+1 pattern?
4. **Test coverage** — Are edge cases covered? Are tests testing behavior, not implementation?
5. **API contracts** — Does it break existing consumers? Is the error response format correct?
6. **Documentation** — Are new endpoints documented in OpenAPI? Is `docs_project/` updated if needed?

**Tone:**
- Comment on the code, not the person
- Distinguish between blocking comments (must fix) and suggestions (nice to have): use "nit:" prefix for non-blocking suggestions
- Provide examples when suggesting alternatives

**Turnaround SLA:**

| PR Size | Expected First Review |
|---------|----------------------|
| Small (< 100 lines) | Within 1 business day |
| Medium (100–500 lines) | Within 2 business days |
| Large (> 500 lines) | Within 3 business days |

If a review is taking longer, comment on the PR to request status. Reviewers should communicate delays proactively.

---

## Testing Requirements

### New Service Methods

Every new service method must have **unit tests**:

```bash
# Test file location
apps/api/src/features/secrets/__tests__/secret.service.test.ts
```

```typescript
describe('SecretService.createSecret', () => {
  it('should encrypt the secret value before storing', async () => { /* ... */ });
  it('should throw ValidationError for name exceeding 100 chars', async () => { /* ... */ });
  it('should emit audit log entry on creation', async () => { /* ... */ });
  it('should throw ForbiddenError if user lacks project write access', async () => { /* ... */ });
});
```

### New API Endpoints

Every new endpoint must have **integration tests** using Supertest:

```bash
# Test file location
apps/api/src/features/secrets/__tests__/secret.routes.test.ts
```

Tests must cover:
- **Happy path** (valid request → correct response shape)
- **Authentication** (missing token → 401, invalid token → 401)
- **Authorization** (insufficient role → 403 or 404)
- **Validation errors** (missing required fields → 400 with error details)
- **Not found** (resource does not exist → 404)
- **Rate limiting** (if rate-limited endpoint)

### New UI Components

React component tests using Vitest + React Testing Library:

```bash
# Test file location
apps/web/src/features/secrets/components/__tests__/SecretCard.test.tsx
```

### E2E Tests (Playwright)

Required for:
- New critical user flows (auth, onboarding, primary CRUD)
- Flows involving multiple services (e.g., create project → add secret → trigger deployment)

Not required for:
- Minor UI-only changes (styling, copy)
- Backend-only changes

---

## Documentation Requirements

If your change affects any of the following, the corresponding document **must be updated in the same PR**:

| Change Type | Required Doc Update |
|-------------|-------------------|
| New API endpoint | `docs_project/api-design.md` + OpenAPI spec |
| New auth mechanism | `docs_project/auth-design.md` |
| New MongoDB collection or schema change | `docs_project/database-design.md` |
| New security control | `docs_project/security.md` |
| New environment variable | `apps/api/.env.example` + `README.md` |
| New package in monorepo | `docs_project/folder-structure.md` |
| Performance-impacting change | `docs_project/performance.md` |
| New architecture decision | `docs_project/adr.md` (see Architecture Decisions below) |

Documentation changes that are cosmetic (typos, formatting) do not require a separate issue — open the PR directly with type `docs`.

---

## Release Process

SELADEV follows **Semantic Versioning** (SemVer):

- **Patch** (x.x.1) — Bug fixes, non-breaking improvements
- **Minor** (x.1.0) — New features, backward-compatible additions
- **Major** (1.0.0) — Breaking changes

### Creating a Release

Releases are created by maintainers, not contributors. The process:

```bash
# 1. Merge all PRs for the release into `develop`
# 2. Create a release branch
git checkout -b release/v1.1.0

# 3. Update CHANGELOG.md (see CHANGELOG.md format)
#    Move [Unreleased] items to the new version section

# 4. Bump versions
pnpm changeset version   # Uses changesets to bump package versions

# 5. Open release PR: release/v1.1.0 → main

# 6. After merge, tag the release
git tag v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0

# 7. GitHub Actions publishes packages and creates GitHub Release
```

### CHANGELOG Updates

Every PR that introduces a user-facing change must include a changeset:

```bash
pnpm changeset

# Follow the interactive prompt:
# → Select packages affected
# → Choose bump type (patch / minor / major)
# → Write a change summary (this becomes the CHANGELOG entry)
```

Changeset files (`.changeset/*.md`) are committed with the PR and consumed during the release process.

---

## Architecture Decisions

When a PR introduces a **significant architectural choice** — a new library, a change to the data model, a new communication pattern — an Architecture Decision Record (ADR) must be written.

### When to Write an ADR

Write an ADR when:
- Choosing between two or more substantial technical approaches
- Making a decision that will be difficult or costly to reverse
- Introducing a new external dependency
- Changing a pattern that affects multiple features (e.g., changing the repository interface)

Do not write an ADR for:
- Implementation details within a single feature
- Minor library upgrades
- Style or formatting decisions

### ADR Format

Add the ADR to `docs_project/adr.md` following the existing format:

```markdown
## ADR-XXX: [Title]

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-YYY  
**Date:** YYYY-MM-DD

### Context
What situation or problem prompted this decision?

### Decision
What was decided?

### Rationale
Why was this chosen over alternatives?

### Consequences
What are the positive and negative outcomes of this decision?

### Alternatives Considered
What else was considered and why was it rejected?
```

ADR numbers are sequential. Find the next available number in `docs_project/adr.md` and claim it in your PR.

---

## Getting Help

- **Discord:** [seladev.dev/discord](https://seladev.dev/discord) — `#contributing` channel for questions
- **GitHub Discussions:** For feature proposals and architecture discussions
- **GitHub Issues:** For bug reports (use the bug report template)
- **Email:** [engineering@seladev.dev](mailto:engineering@seladev.dev) for security concerns

---

*Thank you for contributing to SELADEV. Every PR, bug report, and documentation improvement makes the platform better for every developer who uses it.*
