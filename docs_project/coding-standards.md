# SELADEV — TypeScript Coding Standards

## Purpose

This document defines the authoritative TypeScript coding standards, naming conventions, and architectural patterns for the SELADEV Internal Developer Platform. It applies to all engineers contributing to any package in the monorepo: `apps/api`, `apps/web`, and `packages/*`. New contributors must read this document before submitting their first PR. Staff engineers should use this as a review reference.

## Context

SELADEV is a multi-tenant IDP built on a MERN stack with full TypeScript coverage across frontend and backend. Without enforced standards, a platform of this complexity collapses under inconsistency — especially across the feature-based folder structure where multiple engineers work in parallel. These standards exist to make the codebase predictable, reviewable, and refactorable at scale.

---

## 1. TypeScript Configuration

### Root `tsconfig.json`

```jsonc
// tsconfig.base.json (shared across packages)
{
  "compilerOptions": {
    // Strictness
    "strict": true,                        // Enables all strict checks below
    "noImplicitAny": true,                 // Ban implicit `any` — forces explicit types
    "strictNullChecks": true,              // null/undefined are not assignable to other types
    "strictFunctionTypes": true,           // Strict function parameter contravariance
    "strictBindCallApply": true,           // Type-safe bind/call/apply
    "strictPropertyInitialization": true,  // Class props must be initialized in constructor
    "noImplicitThis": true,                // Ban `this` with implicit any type
    "alwaysStrict": true,                  // Emit "use strict" in all output files

    // Error Prevention
    "noUnusedLocals": true,                // Error on declared-but-unused variables
    "noUnusedParameters": true,            // Error on declared-but-unused function parameters
    "noImplicitReturns": true,             // All code paths must return a value
    "noFallthroughCasesInSwitch": true,    // Disallow switch fallthrough without break/return
    "exactOptionalPropertyTypes": true,    // `{a?: string}` rejects `{a: undefined}` explicitly
    "noUncheckedIndexedAccess": true,      // Array[n] returns T | undefined, not T

    // Module Resolution
    "moduleResolution": "bundler",         // Aligns with Vite (web) and modern Node (api)
    "esModuleInterop": true,               // Allow default imports from CommonJS modules
    "resolveJsonModule": true,             // Allow importing .json files
    "isolatedModules": true,               // Each file must be independently transpilable (required by esbuild)

    // Output
    "target": "ES2022",                    // Node 20+ / modern browsers support all ES2022 features
    "lib": ["ES2022"],                     // DOM lib added per-package for web only
    "declaration": true,                   // Emit .d.ts files for packages
    "declarationMap": true,                // Source maps for .d.ts files
    "sourceMap": true,                     // Enable debugging

    // Paths
    "baseUrl": ".",
    "paths": {
      "@seladev/*": ["packages/*/src"]     // Internal package aliases
    }
  }
}
```

**API-specific overrides** (`apps/api/tsconfig.json`):
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "emitDecoratorMetadata": false         // We do NOT use decorators; keep DI explicit
  }
}
```

**Web-specific overrides** (`apps/web/tsconfig.json`):
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true                         // Vite handles transpilation; tsc only type-checks
  }
}
```

### Why `exactOptionalPropertyTypes`

This catches a common class of bugs where `undefined` is passed for an optional property:

```typescript
// BAD — silently accepted without exactOptionalPropertyTypes
interface Config { timeout?: number }
const c: Config = { timeout: undefined }; // compiles, but confusing

// GOOD — explicitly omit the key if not providing a value
const c: Config = {}; // correct
```

---

## 2. Naming Conventions

| Artifact | Convention | Example |
|---|---|---|
| File (module) | `kebab-case` | `user-repository.ts` |
| File (React component) | `PascalCase` | `ProjectCard.tsx` |
| File (test) | `*.test.ts` / `*.spec.ts` | `auth.service.test.ts` |
| Class | `PascalCase` | `DeploymentService` |
| Interface | `PascalCase`, no `I` prefix | `UserRepository` |
| Type alias | `PascalCase` | `CreateProjectDto` |
| Enum | `PascalCase`, members `SCREAMING_SNAKE` | `DeploymentStatus.IN_PROGRESS` |
| Constant | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_ATTEMPTS` |
| Function / method | `camelCase` | `createDeployment()` |
| Variable | `camelCase` | `currentUser` |
| Boolean variable | `is*`, `has*`, `can*`, `should*` | `isAuthenticated`, `hasAccess` |
| React component | `PascalCase` | `DeploymentStatusBadge` |
| React hook | `use*` | `useDeploymentStatus` |
| Zod schema | `camelCase` + `Schema` suffix | `createProjectSchema` |
| DTO type (inferred) | `PascalCase` + `Dto` suffix | `CreateProjectDto` |
| Mongoose model | `PascalCase` | `ProjectModel` |
| Mongoose document type | `PascalCase` + `Document` suffix | `ProjectDocument` |
| Environment variable | `SCREAMING_SNAKE_CASE` | `JWT_PRIVATE_KEY` |

### File Naming Rules

- All source files use `kebab-case` regardless of what they export.
- React component files use `PascalCase` to match component name.
- Test files co-locate with their subject: `user-service.ts` → `user-service.test.ts`.
- No `index.ts` files except for barrel exports in feature folders.

```
features/
  deployments/
    deployment.controller.ts     ✓
    deployment.service.ts        ✓
    deployment.repository.ts     ✓
    deployment.routes.ts         ✓
    deployment.schema.ts         ✓ (Zod schemas)
    deployment.model.ts          ✓ (Mongoose model)
    deployment.types.ts          ✓ (types/interfaces)
    index.ts                     ✓ (barrel — only public API exports)
    deployment.service.test.ts   ✓ (co-located unit test)
```

---

## 3. Code Organization Rules

### Feature-Based Structure

SELADEV uses a strict feature-based folder structure. **Never organize by layer** (`controllers/`, `services/`, `repositories/` at root level). Each feature owns all its layers.

```
apps/api/src/
├── features/
│   ├── auth/
│   ├── projects/
│   ├── deployments/
│   ├── secrets/
│   ├── webhooks/
│   └── audit-logs/
├── shared/
│   ├── errors/          # Custom error classes
│   ├── middleware/      # Express middleware
│   ├── utils/           # Pure utility functions
│   ├── types/           # Shared TypeScript types
│   └── config/          # Validated environment config
└── app.ts               # Express app assembly
```

### Import Order

Enforced by ESLint `import/order`. The sequence:

```typescript
// 1. Node built-ins
import { readFileSync } from 'fs';
import path from 'path';

// 2. External packages
import express from 'express';
import { z } from 'zod';

// 3. Internal packages (monorepo)
import { logger } from '@seladev/logger';

// 4. Internal absolute imports (from src/)
import { ProjectRepository } from '@/features/projects/project.repository';

// 5. Relative imports (same feature)
import { DeploymentService } from './deployment.service';
import type { CreateDeploymentDto } from './deployment.types';
```

Always use `import type` for type-only imports. This eliminates circular dependency risks and is required by `isolatedModules`.

### Barrel Exports

Each feature's `index.ts` exports only the public API. Internals (repository, model, schema) are NOT re-exported unless explicitly needed by another feature.

```typescript
// features/projects/index.ts — public API only
export { ProjectService } from './project.service';
export type { CreateProjectDto, UpdateProjectDto } from './project.types';
// ProjectRepository is NOT exported — it's an implementation detail
```

---

## 4. Error Handling Patterns

### Never Throw Strings or Plain Objects

```typescript
// BAD
throw 'User not found';
throw { message: 'Not found', status: 404 };

// GOOD
throw new NotFoundError('User', userId);
```

### Always Use the Custom Error Hierarchy

```typescript
// BAD — generic Error loses semantic meaning
throw new Error('Duplicate project name');

// GOOD — ConflictError maps to 409 automatically in global error handler
throw new ConflictError('Project name already exists in this organization');
```

### Handle Errors at the Right Level

- **Controllers** do NOT catch errors — they delegate to the async wrapper which forwards to global handler.
- **Services** catch only errors they can meaningfully handle (e.g., wrap Mongoose E11000 into `ConflictError`).
- **Repositories** do NOT catch errors — they propagate upward for services to handle.

```typescript
// project.repository.ts
async create(data: CreateProjectDto): Promise<ProjectDocument> {
  // Let errors propagate — the service decides what to do with E11000
  return ProjectModel.create(data);
}

// project.service.ts
async create(orgId: string, dto: CreateProjectDto): Promise<Project> {
  try {
    const doc = await this.projectRepository.create({ ...dto, orgId });
    return toProjectDto(doc);
  } catch (err) {
    if (isMongooseDuplicateKeyError(err)) {
      throw new ConflictError(`Project "${dto.name}" already exists in this organization`);
    }
    throw err; // Re-throw unknown errors — don't swallow
  }
}
```

---

## 5. Async/Await Patterns

### Never Mix Callbacks and Promises

```typescript
// BAD — callback inside async function
async function readConfig(): Promise<Config> {
  return new Promise((resolve) => {
    fs.readFile('config.json', (err, data) => { // mixing paradigms
      resolve(JSON.parse(data.toString()));
    });
  });
}

// GOOD — use promisified APIs
import { readFile } from 'fs/promises';

async function readConfig(): Promise<Config> {
  const data = await readFile('config.json', 'utf-8');
  return JSON.parse(data);
}
```

### Always Handle Promise Rejections

```typescript
// BAD — floating promise, rejection is unhandled
someAsyncFunction();

// GOOD — await or explicitly void with error handler
await someAsyncFunction();

// Acceptable only for fire-and-forget with catch
void someAsyncFunction().catch(logger.error);
```

### Sequential vs Parallel Execution

```typescript
// BAD — sequential when tasks are independent (slow)
const user = await userRepo.findById(userId);
const org = await orgRepo.findById(orgId);

// GOOD — parallel when independent
const [user, org] = await Promise.all([
  userRepo.findById(userId),
  orgRepo.findById(orgId),
]);
```

### Avoid `async` on Functions That Don't `await`

```typescript
// BAD — unnecessary async wrapper
async function double(n: number): Promise<number> {
  return n * 2; // no await needed
}

// GOOD
function double(n: number): number {
  return n * 2;
}
```

---

## 6. Repository Pattern Conventions

### Interface First, Implementation Separate

Every repository has an interface and a Mongoose implementation. Services depend on the interface.

```typescript
// project.repository.ts — interface
export interface ProjectRepository {
  findById(id: string): Promise<ProjectDocument | null>;
  findByOrgId(orgId: string, pagination: PaginationDto): Promise<PagedResult<ProjectDocument>>;
  create(data: CreateProjectData): Promise<ProjectDocument>;
  updateById(id: string, update: Partial<ProjectData>): Promise<ProjectDocument | null>;
  deleteById(id: string): Promise<boolean>;
  existsByNameInOrg(name: string, orgId: string): Promise<boolean>;
}

// project.mongoose-repository.ts — implementation
export class MongooseProjectRepository implements ProjectRepository {
  async findById(id: string): Promise<ProjectDocument | null> {
    return ProjectModel.findById(id).lean().exec();
  }
  // ...
}
```

### No Direct Mongoose in Services

```typescript
// BAD — service imports and uses Mongoose model directly
import { ProjectModel } from './project.model';

class ProjectService {
  async getProject(id: string) {
    return ProjectModel.findById(id); // Mongoose in service layer
  }
}

// GOOD — service uses repository interface
class ProjectService {
  constructor(private readonly projectRepo: ProjectRepository) {}

  async getProject(id: string): Promise<Project> {
    const doc = await this.projectRepo.findById(id);
    if (!doc) throw new NotFoundError('Project', id);
    return toProjectDto(doc);
  }
}
```

### Use `.lean()` for Read Operations

```typescript
// BAD — full Mongoose document returned for read-only operations (performance cost)
return ProjectModel.findById(id).exec();

// GOOD — lean() returns plain JS object, much faster for reads
return ProjectModel.findById(id).lean().exec();
```

---

## 7. Service Layer Conventions

### One Class Per Feature, Constructor Injection

```typescript
export class DeploymentService {
  constructor(
    private readonly deploymentRepo: DeploymentRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly deploymentQueue: DeploymentQueue,
    private readonly auditLogger: AuditLogger,
  ) {}
  // methods...
}
```

### No Static Methods

Static methods cannot be mocked in unit tests and violate dependency injection principles.

```typescript
// BAD
class ProjectService {
  static async create(dto: CreateProjectDto) { ... }
}

// GOOD — instance method, class is instantiated via DI
class ProjectService {
  async create(dto: CreateProjectDto) { ... }
}
```

### Services Return Plain DTOs, Not Documents

```typescript
// BAD — leaks Mongoose document to controller
async getProject(id: string): Promise<ProjectDocument> { ... }

// GOOD — map to plain DTO before returning
async getProject(id: string): Promise<ProjectDto> {
  const doc = await this.projectRepo.findById(id);
  if (!doc) throw new NotFoundError('Project', id);
  return mapToProjectDto(doc);
}
```

### Single Responsibility

Each service class owns one feature. A `ProjectService` does not touch `DeploymentModel`. If inter-feature operations are needed, inject the relevant repository or service.

---

## 8. Controller Conventions

Controllers are thin. They parse → delegate → respond. **No business logic.**

```typescript
// deployment.controller.ts
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  createDeployment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    // Parse: validate and extract input
    const dto = createDeploymentSchema.parse(req.body);
    const { projectId } = req.params;
    const { userId, orgId } = req.user; // set by auth middleware

    // Delegate: call service
    const deployment = await this.deploymentService.create(orgId, projectId, userId, dto);

    // Respond
    res.status(201).json({ success: true, data: deployment });
  });
}
```

**What a controller must NOT do:**
- Query a database
- Apply business rules ("only owners can delete")
- Format output beyond wrapping in `{ success, data }`
- Call `next(err)` explicitly — the `asyncWrapper` handles it

---

## 9. Zod Schema Conventions

### Where Schemas Live

- API request validation schemas: `apps/api/src/features/<feature>/<feature>.schema.ts`
- Shared schemas (used by FE and BE): `packages/schemas/src/<feature>.schema.ts`
- Frontend form schemas: `apps/web/src/features/<feature>/schemas/<form-name>.schema.ts`

### Naming Convention

```typescript
// Schema objects: camelCase + "Schema" suffix
export const createProjectSchema = z.object({ ... });
export const updateProjectSchema = createProjectSchema.partial();
export const projectIdParamSchema = z.object({ projectId: z.string().cuid() });

// Inferred types: PascalCase + "Dto" suffix
export type CreateProjectDto = z.infer<typeof createProjectSchema>;
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
```

### Shared Between FE/BE

Place schemas in `packages/schemas` when they're used in both directions. Import the type on both sides — this guarantees FE form validation matches BE API validation.

```typescript
// packages/schemas/src/project.schema.ts
export const createProjectSchema = z.object({
  name: z.string().min(2).max(64).trim(),
  description: z.string().max(500).optional(),
  environment: z.enum(['development', 'staging', 'production']),
});
```

### Error Formatting

Parse with `safeParse` in middleware, not `parse` — this avoids unhandled throws in middleware and gives clean error output.

```typescript
const result = schema.safeParse(req.body);
if (!result.success) {
  throw new ValidationError(formatZodError(result.error));
}
```

---

## 10. TypeScript Utility Types

Use built-in utility types; do not re-implement them.

| Utility | When to Use | Example |
|---|---|---|
| `Partial<T>` | Update DTOs where all fields are optional | `type UpdateProjectDto = Partial<CreateProjectDto>` |
| `Required<T>` | Force all fields present | `Required<Config>` |
| `Pick<T, K>` | Subset of a type for a specific context | `Pick<User, 'id' \| 'email'>` |
| `Omit<T, K>` | Remove sensitive/internal fields | `Omit<UserDocument, 'passwordHash'>` |
| `Readonly<T>` | Configuration and constants | `const config: Readonly<AppConfig> = { ... }` |
| `Record<K, V>` | Maps/dictionaries | `Record<string, DeploymentStatus>` |
| `ReturnType<F>` | Infer return type from function | `ReturnType<typeof createProject>` |
| `Awaited<T>` | Unwrap Promise return type | `Awaited<ReturnType<typeof fetchUser>>` |
| `NonNullable<T>` | Remove null/undefined | `NonNullable<ProjectDocument>` |

```typescript
// BAD — manual re-implementation of utility types
type UpdateProjectDto = {
  name?: string;
  description?: string;
};

// GOOD — derive from source of truth
type UpdateProjectDto = Partial<CreateProjectDto>;
```

---

## 11. ESLint Rules

Key rules enforced in `.eslintrc.json`:

```jsonc
{
  "rules": {
    // TypeScript
    "@typescript-eslint/no-explicit-any": "error",         // Ban `any`; use `unknown` instead
    "@typescript-eslint/no-floating-promises": "error",    // All promises must be handled
    "@typescript-eslint/await-thenable": "error",          // Only await actual Promises
    "@typescript-eslint/no-misused-promises": "error",     // Catch promise-as-bool bugs
    "@typescript-eslint/consistent-type-imports": "error", // Enforce `import type`
    "@typescript-eslint/no-unused-vars": ["error", {       // Prefix with _ to exempt
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_"
    }],
    "@typescript-eslint/explicit-function-return-type": "off", // Return type inference OK in small fns
    "@typescript-eslint/no-non-null-assertion": "warn",    // Prefer proper null checks

    // Imports
    "import/order": ["error", {                            // Enforced import ordering
      "groups": ["builtin", "external", "internal", "parent", "sibling"],
      "newlines-between": "always"
    }],
    "import/no-default-export": "error",                   // Named exports only (except React components)
    "import/no-cycle": "error",                            // No circular imports

    // General
    "no-console": ["warn", { "allow": ["warn", "error"] }], // Use logger, not console.log
    "eqeqeq": ["error", "always"],                         // Always === never ==
    "prefer-const": "error",                               // Use const unless reassigned
    "no-var": "error"                                      // Never use var
  }
}
```

---

## 12. Comment Standards

### JSDoc for Public APIs

All exported functions, classes, and interfaces must have JSDoc comments.

```typescript
/**
 * Creates a new deployment for the given project and environment.
 *
 * Enqueues a BullMQ job that progresses through: QUEUED → RUNNING → SUCCESS | FAILED.
 * Emits a `deployment.created` audit log event.
 *
 * @param orgId - The organization ID (used for RBAC scope)
 * @param projectId - The project to deploy
 * @param userId - The actor initiating the deployment
 * @param dto - Deployment configuration payload
 * @returns The created deployment record in QUEUED status
 * @throws {NotFoundError} If the project does not exist or belongs to a different org
 * @throws {ForbiddenError} If the user lacks DEPLOY permission on this project
 */
async create(
  orgId: string,
  projectId: string,
  userId: string,
  dto: CreateDeploymentDto,
): Promise<DeploymentDto> { ... }
```

### Inline Comments — Non-Obvious Logic Only

```typescript
// BAD — comment restates the code
const doubled = value * 2; // multiply by 2

// GOOD — comment explains WHY, not WHAT
// BullMQ exponential backoff: delay = baseDelay * 2^attempt, capped at 30s
const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30_000);
```

### TODO / FIXME Format

```typescript
// TODO(username): Remove once migration to v2 API is complete — tracked in SELADEV-412
// FIXME(username): Race condition when two workers pick up the same job — SELADEV-389
```

---

## 13. Anti-Patterns to Avoid

### `any` as an Escape Hatch

```typescript
// BAD
function processPayload(data: any) { ... }

// GOOD — use `unknown` and narrow
function processPayload(data: unknown) {
  if (!isValidPayload(data)) throw new ValidationError('Invalid payload');
  // data is now narrowed
}
```

### Implicit Return Types on Complex Functions

```typescript
// BAD — return type inferred incorrectly in complex branching
async function getUser(id: string) { ... }

// GOOD — explicit return type documents intent
async function getUser(id: string): Promise<UserDto | null> { ... }
```

### God Services

```typescript
// BAD — one service does everything
class AppService {
  createProject() { ... }
  createDeployment() { ... }
  rotateSecrets() { ... }
  sendWebhook() { ... }
}
```

### Direct `process.env` Access

```typescript
// BAD — unvalidated, untyped, scattered env access
const port = process.env.PORT;

// GOOD — use validated config singleton
import { config } from '@/shared/config';
const port = config.server.port;
```

### Swallowing Errors

```typescript
// BAD — error disappears silently
try {
  await riskyOperation();
} catch (_err) {
  // nothing
}

// GOOD — at minimum log; usually re-throw
try {
  await riskyOperation();
} catch (err) {
  logger.error({ err }, 'riskyOperation failed');
  throw err;
}
```

### Mutating Function Arguments

```typescript
// BAD — side-effectful, unpredictable
function sanitize(user: User): void {
  user.name = user.name.trim(); // mutates caller's object
}

// GOOD — return new object
function sanitize(user: User): User {
  return { ...user, name: user.name.trim() };
}
```

---

## 14. Git Commit Conventions

SELADEV uses [Conventional Commits](https://www.conventionalcommits.org/). All commits are linted by `commitlint` in CI.

### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to Use |
|---|---|
| `feat` | A new feature (triggers minor version bump) |
| `fix` | A bug fix (triggers patch version bump) |
| `chore` | Build system, dependency updates, tooling |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only changes |
| `test` | Adding or correcting tests |
| `perf` | Performance improvement |
| `ci` | CI/CD pipeline changes |
| `style` | Formatting, whitespace — no logic change |
| `revert` | Reverts a previous commit |

### Scopes (SELADEV-specific)

`api`, `web`, `worker`, `auth`, `projects`, `deployments`, `secrets`, `webhooks`, `audit`, `config`, `docker`, `ci`, `shared`

### Examples

```
feat(deployments): add rollback API endpoint for failed deployments

fix(auth): refresh token not invalidated on password change

refactor(projects): extract project validation into dedicated service method

chore(deps): upgrade zod from 3.21.0 to 3.22.4

test(webhooks): add integration test for HMAC signature verification

docs(api): update OpenAPI spec for /v1/secrets endpoints

BREAKING CHANGE: JWT payload now includes orgId claim — clients must re-authenticate
```

---

## 15. Code Review Checklist

Use this checklist before approving any PR. All items are required unless justified.

### TypeScript & Types
- [ ] No `any` usage without explicit comment justification
- [ ] All public functions have explicit return types
- [ ] `import type` used for type-only imports
- [ ] No type assertions (`as X`) unless unavoidable with comment

### Architecture
- [ ] Service does not import Mongoose models directly
- [ ] Controller contains no business logic
- [ ] Repository interface updated if behavior changed
- [ ] No circular imports (`import/no-cycle` passes)
- [ ] New feature follows feature-based folder structure

### Error Handling
- [ ] No `throw` of strings or plain objects
- [ ] Errors use the correct class from the hierarchy (see `error-handling.md`)
- [ ] No swallowed catch blocks
- [ ] Async functions are awaited or `.catch()` handled

### Testing
- [ ] Unit tests cover the happy path and primary error cases
- [ ] New repository methods have integration tests
- [ ] Test coverage does not regress below thresholds (see `testing-strategy.md`)

### Security
- [ ] No sensitive data logged (passwords, tokens, keys)
- [ ] User input goes through Zod validation before use
- [ ] No direct `process.env` access — use config singleton
- [ ] New endpoints have RBAC middleware applied

### Docs & Comments
- [ ] New exported public APIs have JSDoc
- [ ] Complex logic has explanatory inline comments
- [ ] PR description explains the "why" behind the change

### Commit Quality
- [ ] Commits follow Conventional Commits format
- [ ] PR title is a valid conventional commit (used as squash message)
- [ ] No `WIP` or `temp` commits in the branch

---

## Decisions

1. **No `I` prefix on interfaces** — The `IUserRepository` convention is a C# holdover. TypeScript interfaces and classes share the same namespace, so naming them the same (one is the contract, one is the impl) is clean: `UserRepository` (interface) + `MongooseUserRepository` (impl).

2. **Named exports only** — Default exports break discoverability and refactoring tools. `import/no-default-export` is enforced everywhere except React component files (where React conventions apply).

3. **`.lean()` on read queries** — Mongoose documents carry significant prototype overhead. For high-throughput read operations, `.lean()` returns raw JS objects, providing significant performance gains.

4. **No decorators** — `emitDecoratorMetadata` is disabled. Decorators (e.g., from NestJS-style DI) add compile complexity and require `reflect-metadata`. SELADEV uses explicit constructor injection — simpler and equally testable.

## Tradeoffs

- **`noUncheckedIndexedAccess`** forces `T | undefined` for all array accesses. This adds minor verbosity (null checks on array results) but eliminates a class of `undefined is not a function` runtime crashes.
- **Feature-based structure** over layer-based means each feature is self-contained but can lead to duplicate utility code — solved by the `shared/` directory and strict ESLint `import/no-cycle` enforcement.
- **No static methods** makes every dependency injectable but adds instantiation overhead — negligible in practice and outweighed by testability gains.

## Future Improvements

- Adopt [`ts-reset`](https://github.com/total-typescript/ts-reset) to further harden type safety (e.g., `.filter(Boolean)` returns `T[]` not `(T | undefined)[]`).
- Evaluate `@effect/schema` as a Zod alternative for more powerful branded types and schema composition.
- Add `eslint-plugin-boundaries` to enforce inter-feature import rules (features cannot import from each other's internals).
- Automate commit message validation with `husky` + `commitlint` pre-commit hooks wired to the monorepo.
