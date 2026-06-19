# Testing Strategy

**Document Type:** Engineering Standards  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the testing philosophy, tooling, test pyramid, coverage contracts, and implementation patterns for the IDP. It answers: what we test, how we test it, what we don't test, and why. Every engineer writing tests should read this before writing their first assertion.

---

## Context

The IDP handles secrets, API keys, access control, and audit logs — all domains where silent failures have real security consequences. The test suite is not a checkbox exercise. It is the primary mechanism for:

1. Catching regressions in security-sensitive code paths (encryption, RBAC enforcement, token rotation)
2. Enabling confident refactoring (repository layer abstraction, service extraction)
3. Documenting expected behavior at the boundary level (what does the API return for an expired token?)

---

## Test Pyramid

```
                    ┌──────────────┐
                    │     E2E      │  ~10 tests
                    │  (Playwright)│  Critical user journeys only
                    └──────┬───────┘
               ┌───────────┴──────────┐
               │     Integration      │  ~80 tests
               │   (Jest + Supertest) │  API endpoints, DB interactions
               └──────────┬───────────┘
          ┌───────────────┴──────────────────┐
          │              Unit                │  ~300 tests
          │  (Vitest/Jest, no I/O)           │  Services, utils, encryption
          └──────────────────────────────────┘
```

### Unit Tests (~300)
- **Scope:** Single function or class. No network, no database, no file system.
- **Speed:** < 5ms per test. Full suite < 30 seconds.
- **Mocking:** All dependencies injected and mocked. Tests do not assert on mock internals unless the call itself is the behavior under test.
- **Location:** `tests/unit/` mirroring `src/` structure.

### Integration Tests (~80)
- **Scope:** Full API request → service → repository → MongoDB → response.
- **Infrastructure:** In-process MongoDB Memory Server (`mongodb-memory-server`). No external connections in CI.
- **Speed:** < 200ms per test. Full suite < 3 minutes.
- **What they verify:** HTTP status codes, response shapes, database state after mutations, error responses for invalid inputs.
- **Location:** `tests/integration/`.

### E2E Tests (~10)
- **Scope:** Full browser, real stack (API + MongoDB + Redis via Docker).
- **Speed:** 30-120 seconds per test. Run only on `main` branch merges and pre-release.
- **What they cover:** Login → create project → create secret → trigger deployment → verify audit log. Not happy-path only — include RBAC failure paths.
- **Tool:** Playwright.

---

## Tooling

### Backend: Jest + Supertest
Jest is used for the API. The mature ecosystem, snapshot support, and `--coverage` integration with Istanbul meet all requirements. Vitest is used only on the frontend (Vite-native).

```typescript
// jest.config.ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFilesAfterFramework: ['<rootDir>/tests/helpers/setup.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'tests/helpers/',
    '*.model.ts',    // Mongoose models: schema only, no logic to test
    'config/',       // Config wiring: tested implicitly
  ],
};
```

### Frontend: Vitest + React Testing Library
```typescript
// vite.config.ts (test section)
test: {
  environment: 'jsdom',
  setupFiles: ['./src/tests/setup.ts'],
  globals: true,
  coverage: {
    provider: 'v8',
    exclude: ['src/components/ui/**'], // shadcn/ui owned components
  }
}
```

### E2E: Playwright
```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,         // E2E tests share state (same DB)
  retries: process.env.CI ? 2 : 0,
  webServer: {
    command: 'docker compose up -d && pnpm dev:test',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## Coverage Contracts

Coverage is a minimum floor, not a target. A 95% coverage score with trivial tests is worthless. Coverage thresholds enforce that every critical path has at least one test — what that test asserts is a code review concern.

| Layer | Minimum Coverage | Rationale |
|---|---|---|
| `features/*/service.ts` | 90% | Business logic. Must be well-tested. |
| `features/auth/` | 95% | Security-critical. Near-complete coverage required. |
| `features/secrets/` | 95% | Security-critical. Encryption paths must be tested. |
| `lib/crypto.ts` | 100% | Every branch of encryption/decryption/hashing must be verified. |
| `middleware/` | 85% | Auth, RBAC, and validation middleware. |
| `features/*/controller.ts` | 70% | Thin wrappers; covered by integration tests. |
| `features/*/repository.ts` | 60% | Data access; covered by integration tests with real DB. |
| Frontend components | 60% | UI components; supplemented by E2E tests. |
| Frontend hooks | 80% | Custom hooks containing business logic. |

CI fails if any threshold is breached. Thresholds are configured per-path in `jest.config.ts`, not as a single global number.

---

## Test Patterns

### Unit: Service Tests

Services are the highest-value test target. They contain all business logic and have all dependencies injected.

```typescript
// tests/unit/features/secrets/secrets.service.test.ts
describe('SecretsService', () => {
  let service: SecretsService;
  let secretsRepo: jest.Mocked<SecretsRepository>;
  let auditLogService: jest.Mocked<AuditLogService>;

  beforeEach(() => {
    secretsRepo = createMock<SecretsRepository>();
    auditLogService = createMock<AuditLogService>();
    service = new SecretsService(secretsRepo, auditLogService);
  });

  describe('createSecret', () => {
    it('encrypts the value before storing', async () => {
      const input = buildCreateSecretInput({ value: 'super-secret' });
      secretsRepo.create.mockResolvedValue(buildSecret());

      await service.createSecret(input);

      const storedPayload = secretsRepo.create.mock.calls[0][0];
      expect(storedPayload.encryptedValue).toBeDefined();
      expect(storedPayload.encryptedValue).not.toBe('super-secret');
      expect(storedPayload.iv).toBeDefined();
      expect(storedPayload.authTag).toBeDefined();
    });

    it('never returns the encrypted value in the response', async () => {
      secretsRepo.create.mockResolvedValue(buildSecret({ encryptedValue: 'cipher' }));
      const result = await service.createSecret(buildCreateSecretInput());

      expect(result).not.toHaveProperty('encryptedValue');
      expect(result).not.toHaveProperty('iv');
      expect(result).not.toHaveProperty('authTag');
    });

    it('records an audit log event', async () => {
      secretsRepo.create.mockResolvedValue(buildSecret());
      await service.createSecret(buildCreateSecretInput());

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'secret.created' })
      );
    });

    it('throws ConflictError if a secret with the same name exists', async () => {
      secretsRepo.create.mockRejectedValue(new MongoError('E11000 duplicate key'));
      await expect(service.createSecret(buildCreateSecretInput())).rejects.toThrow(ConflictError);
    });
  });
});
```

### Unit: Encryption Tests

```typescript
// tests/unit/lib/crypto.test.ts
describe('encryption', () => {
  it('produces different ciphertext for same plaintext (IV randomness)', () => {
    const result1 = encrypt('same-value', 'org-id-123');
    const result2 = encrypt('same-value', 'org-id-123');
    expect(result1.encryptedValue).not.toBe(result2.encryptedValue);
    expect(result1.iv).not.toBe(result2.iv);
  });

  it('decrypts back to original plaintext', () => {
    const { encryptedValue, iv, authTag } = encrypt('hello-world', 'org-id');
    const decrypted = decrypt({ encryptedValue, iv, authTag }, 'org-id');
    expect(decrypted).toBe('hello-world');
  });

  it('throws on tampered ciphertext (auth tag verification)', () => {
    const { encryptedValue, iv, authTag } = encrypt('value', 'org-id');
    const tampered = encryptedValue.slice(0, -4) + 'XXXX';
    expect(() => decrypt({ encryptedValue: tampered, iv, authTag }, 'org-id')).toThrow();
  });

  it('throws on wrong org ID (different derived key)', () => {
    const { encryptedValue, iv, authTag } = encrypt('value', 'org-a');
    expect(() => decrypt({ encryptedValue, iv, authTag }, 'org-b')).toThrow();
  });
});
```

### Integration: API Endpoint Tests

```typescript
// tests/integration/secrets.test.ts
describe('POST /api/v1/projects/:projectId/environments/:envId/secrets', () => {
  let app: Express;
  let authToken: string;
  let projectId: string;
  let envId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const { token, project, environment } = await setupTestContext();
    authToken = token;
    projectId = project.id;
    envId = environment.id;
  });

  it('returns 201 with masked secret on success', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/environments/${envId}/secrets`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'DATABASE_URL', value: 'postgres://localhost' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'DATABASE_URL',
      keyVersion: expect.any(Number),
    });
    expect(res.body.data).not.toHaveProperty('encryptedValue');
    expect(res.body.data).not.toHaveProperty('value');
  });

  it('returns 409 on duplicate secret name in same environment', async () => {
    await createSecret(app, authToken, projectId, envId, { name: 'DUPLICATE' });
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/environments/${envId}/secrets`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'DUPLICATE', value: 'value' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 403 for project:viewer role', async () => {
    const viewerToken = await getTokenForRole('project:viewer', projectId);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/environments/${envId}/secrets`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'FORBIDDEN_SECRET', value: 'value' });

    expect(res.status).toBe(403);
  });

  it('creates an audit log entry', async () => {
    await request(app)
      .post(`/api/v1/projects/${projectId}/environments/${envId}/secrets`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'AUDITED_SECRET', value: 'value' });

    const log = await AuditLog.findOne({ action: 'secret.created', 'resource.name': 'AUDITED_SECRET' });
    expect(log).not.toBeNull();
    expect(log?.actor.email).toBeDefined();
  });
});
```

### RBAC Test Matrix Pattern

Permission tests use a parameterized matrix to ensure every role is tested against every protected action:

```typescript
const permissionMatrix = [
  { role: 'owner',              action: 'DELETE /secrets/:id', expected: 204 },
  { role: 'admin',              action: 'DELETE /secrets/:id', expected: 204 },
  { role: 'project:admin',      action: 'DELETE /secrets/:id', expected: 204 },
  { role: 'project:developer',  action: 'DELETE /secrets/:id', expected: 403 },
  { role: 'project:viewer',     action: 'DELETE /secrets/:id', expected: 403 },
  { role: 'org:viewer',         action: 'DELETE /secrets/:id', expected: 403 },
];

describe.each(permissionMatrix)(
  '$role attempting $action',
  ({ role, expected }) => {
    it(`returns ${expected}`, async () => {
      const token = await getTokenForRole(role);
      const res = await deleteSecret(app, token, secretId);
      expect(res.status).toBe(expected);
    });
  }
);
```

### E2E: Critical Journey

```typescript
// tests/e2e/secret-lifecycle.spec.ts
test('create secret, rotate it, verify audit log', async ({ page }) => {
  await page.goto('/login');
  await loginAs(page, 'admin@test.idp');

  await page.getByRole('link', { name: 'Test Project' }).click();
  await page.getByRole('tab', { name: 'Secrets' }).click();
  await page.getByRole('button', { name: 'New Secret' }).click();

  await page.getByLabel('Name').fill('API_KEY');
  await page.getByLabel('Value').fill('initial-value');
  await page.getByRole('button', { name: 'Save Secret' }).click();

  await expect(page.getByText('API_KEY')).toBeVisible();
  await expect(page.getByText('initial-value')).not.toBeVisible(); // masked

  // Verify audit log entry was created
  await page.getByRole('link', { name: 'Audit Logs' }).click();
  await expect(page.getByText('secret.created')).toBeVisible();
  await expect(page.getByText('API_KEY')).toBeVisible();
});
```

---

## Test Data Management

### Factories

All test data is created via typed factory functions, never via raw object literals:

```typescript
// tests/helpers/factories.ts
export const buildUser = (overrides: Partial<User> = {}): User => ({
  _id: new ObjectId(),
  email: `user-${ulid()}@test.com`,
  passwordHash: '$2b$12$...',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  mfaEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const buildSecret = (overrides: Partial<Secret> = {}): Secret => ({
  _id: new ObjectId(),
  organizationId: new ObjectId(),
  projectId: new ObjectId(),
  environmentId: new ObjectId(),
  name: `SECRET_${ulid()}`,
  encryptedValue: 'encrypted-placeholder',
  iv: 'iv-placeholder',
  authTag: 'tag-placeholder',
  keyVersion: 1,
  createdAt: new Date(),
  ...overrides,
});
```

Factories use `ulid()` for unique names to prevent test pollution. They accept overrides for scenario-specific customization.

### Database Isolation

Each integration test file runs against a fresh MongoDB Memory Server instance. Tests within a file share one instance but reset collections between tests with `beforeEach`:

```typescript
// tests/helpers/db.ts
beforeEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map(c => c.deleteMany({})));
});
```

---

## What We Don't Test

| What | Why |
|---|---|
| Mongoose model definitions | Schema-only files. No logic. Caught by integration tests. |
| `shadcn/ui` components | Third-party component behavior. Not our responsibility. |
| Config parsing (happy path) | Trivially obvious. Sad paths (missing vars) validated at startup. |
| Third-party SDK internals | BullMQ, Socket.IO behavior. We test our usage, not the library. |
| Styling / CSS | Visual regression is a Storybook/Chromatic concern, not unit/integration. |

---

## CI Enforcement

```yaml
# .github/workflows/ci.yml (test stage)
- name: Run unit tests
  run: pnpm test:unit --coverage

- name: Run integration tests
  run: pnpm test:integration --coverage

- name: Check coverage thresholds
  run: pnpm test:coverage:check

- name: Run E2E tests (main branch only)
  if: github.ref == 'refs/heads/main'
  run: pnpm test:e2e
```

All unit and integration tests must pass on every PR. Coverage check failure blocks merge. E2E tests run only on `main` to avoid slow feedback on feature branches.

---

## Future Improvements

- **Contract testing (Pact)** — When the IDP evolves to have multiple API consumers (CLI, mobile), Pact consumer-driven contracts prevent breaking changes silently.
- **Mutation testing (Stryker)** — Validates that tests actually catch bugs by injecting faults. Planned for the auth and secrets features specifically.
- **Visual regression (Chromatic)** — Storybook + Chromatic for catching UI regressions in the component library.
- **Load testing (k6)** — Baseline performance benchmarks for the audit log write path and secret read path under concurrent load.