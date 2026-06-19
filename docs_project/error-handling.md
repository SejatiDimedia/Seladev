# SELADEV — Error Handling Design

## Purpose

This document defines the error handling architecture for the SELADEV Internal Developer Platform. It covers the custom error class hierarchy, error codes registry, global Express error handler, async wrapper pattern, MongoDB and BullMQ error handling, logging strategy, frontend error normalization, and security guidelines around what error information is safe to expose. Read this alongside `api-design.md` (error response contract) and `coding-standards.md` (throw conventions).

## Context

A consistent, predictable error handling system is foundational to a platform API. Without it, HTTP status codes are inconsistent, error shapes vary by controller, sensitive stack traces leak to clients, and debugging across distributed components becomes guesswork. SELADEV's error system is designed around three principles:

1. **Classify first** — Every error is either operational (expected, recoverable) or programmer (unexpected, crash-worthy).
2. **Centralize** — One global error handler converts all errors to HTTP responses. No ad-hoc error shaping in controllers.
3. **Correlate** — Every error carries a request ID so logs can be traced end-to-end.

---

## 1. Error Classification

### Operational Errors

Errors that are expected as part of normal program flow. They represent a condition the API should handle gracefully and return a meaningful response for. These are **not** bugs.

| Category | Examples |
|---|---|
| Validation | Missing required field, invalid email format, string too long |
| Authentication | Expired JWT, invalid credentials, missing Authorization header |
| Authorization | User lacks required role or permission |
| Not Found | Resource ID does not exist in the database |
| Conflict | Duplicate name, concurrent modification |
| Rate Limit | Too many requests from a single client |
| Business Rule | Cannot deploy to production without passing staging |

### Programmer Errors

Errors that indicate a bug in the code. These should **crash the process** (or at minimum be logged as critical) rather than returning a graceful 500, because they signal a broken state.

| Category | Examples |
|---|---|
| Type errors | Accessing `.id` on undefined |
| Logic errors | Divide by zero, index out of bounds |
| Contract violations | Calling a function with wrong argument types |
| Unhandled promise rejections | Forgotten `await` or missing `.catch()` |

SELADEV distinguishes these using the `isOperational` flag on `BaseError`. The global error handler uses this flag to decide between returning a user-facing error response and triggering a process restart signal.

---

## 2. Custom Error Class Hierarchy

All errors in the SELADEV backend extend `BaseError`. This lives in `apps/api/src/shared/errors/`.

### BaseError

```typescript
// shared/errors/base.error.ts
export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational: boolean;
  readonly timestamp: string;

  constructor(
    message: string,
    isOperational = true,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    // Restore prototype chain (required when extending built-in Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
    // Capture clean stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}
```

> **Why `Object.setPrototypeOf`?** TypeScript compiles `class Foo extends Error` in a way that breaks `instanceof` checks. This line restores the prototype chain so `err instanceof ValidationError` works correctly in the global handler.

### ValidationError

```typescript
// shared/errors/validation.error.ts
import type { FieldError } from '@seladev/schemas';

export class ValidationError extends BaseError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';

  constructor(
    public readonly fieldErrors: FieldError[],
    message = 'Request validation failed',
  ) {
    super(message, true, { fields: fieldErrors });
  }
}

// Type used in response body
export interface FieldError {
  field: string;   // dot-path: "config.timeout"
  message: string; // human-readable: "Must be a positive integer"
  code: string;    // machine code: "too_small"
}
```

### AuthenticationError

```typescript
// shared/errors/authentication.error.ts
export class AuthenticationError extends BaseError {
  readonly statusCode = 401;
  readonly code: string;

  constructor(
    message = 'Authentication required',
    code: AuthErrorCode = 'AUTH_REQUIRED',
  ) {
    super(message);
    this.code = code;
  }
}

export type AuthErrorCode =
  | 'AUTH_REQUIRED'         // No token provided
  | 'TOKEN_EXPIRED'         // JWT exp claim has passed
  | 'TOKEN_INVALID'         // Signature verification failed
  | 'TOKEN_MALFORMED'       // Cannot parse JWT
  | 'REFRESH_TOKEN_EXPIRED' // Refresh token past its TTL
  | 'REFRESH_TOKEN_REUSED'  // Token reuse detected — security event
  | 'INVALID_CREDENTIALS';  // Wrong email/password
```

### ForbiddenError

```typescript
// shared/errors/forbidden.error.ts
export class ForbiddenError extends BaseError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';

  constructor(
    message = 'You do not have permission to perform this action',
    public readonly requiredPermission?: string,
  ) {
    super(message);
  }
}
```

### NotFoundError

```typescript
// shared/errors/not-found.error.ts
export class NotFoundError extends BaseError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor(resource: string, id?: string) {
    const message = id
      ? `${resource} with ID "${id}" was not found`
      : `${resource} was not found`;
    super(message);
  }
}
```

### ConflictError

```typescript
// shared/errors/conflict.error.ts
export class ConflictError extends BaseError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message);
  }
}
```

### BusinessRuleViolationError

```typescript
// shared/errors/business-rule.error.ts
export class BusinessRuleViolationError extends BaseError {
  readonly statusCode = 422;
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// Usage example:
throw new BusinessRuleViolationError(
  'Cannot delete a project with active deployments',
  'PROJECT_HAS_ACTIVE_DEPLOYMENTS',
);
```

### RateLimitError

```typescript
// shared/errors/rate-limit.error.ts
export class RateLimitError extends BaseError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(
    public readonly retryAfterSeconds: number,
    message = 'Too many requests. Please slow down.',
  ) {
    super(message);
  }
}
```

### ServiceUnavailableError

```typescript
// shared/errors/service-unavailable.error.ts
export class ServiceUnavailableError extends BaseError {
  readonly statusCode = 503;
  readonly code = 'SERVICE_UNAVAILABLE';

  constructor(
    service: string,
    message?: string,
  ) {
    super(message ?? `${service} is temporarily unavailable. Please try again shortly.`);
  }
}
```

### InternalError

```typescript
// shared/errors/internal.error.ts
export class InternalError extends BaseError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_ERROR';

  constructor(message = 'An unexpected error occurred', cause?: unknown) {
    super(message, false); // isOperational = false — this is a programmer error
    if (cause) this.cause = cause;
  }
}
```

---

## 3. Error Codes Registry

Error codes are **stable string identifiers** — never change them once published, as clients may depend on them. They follow `SCREAMING_SNAKE_CASE`.

| Code | HTTP Status | Class | Description |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | `ValidationError` | Request body/params/query failed schema validation |
| `AUTH_REQUIRED` | 401 | `AuthenticationError` | No Authorization header present |
| `TOKEN_EXPIRED` | 401 | `AuthenticationError` | JWT access token has expired |
| `TOKEN_INVALID` | 401 | `AuthenticationError` | JWT signature verification failed |
| `TOKEN_MALFORMED` | 401 | `AuthenticationError` | Cannot parse JWT structure |
| `REFRESH_TOKEN_EXPIRED` | 401 | `AuthenticationError` | Refresh token past TTL |
| `REFRESH_TOKEN_REUSED` | 401 | `AuthenticationError` | Refresh token replay detected |
| `INVALID_CREDENTIALS` | 401 | `AuthenticationError` | Wrong email or password |
| `FORBIDDEN` | 403 | `ForbiddenError` | Authenticated but lacks required permission |
| `NOT_FOUND` | 404 | `NotFoundError` | Resource does not exist |
| `CONFLICT` | 409 | `ConflictError` | Duplicate resource or concurrent modification |
| `PROJECT_HAS_ACTIVE_DEPLOYMENTS` | 422 | `BusinessRuleViolationError` | Delete blocked by active deployments |
| `SECRET_KEY_ALREADY_EXISTS` | 422 | `BusinessRuleViolationError` | Duplicate secret key in environment |
| `RATE_LIMIT_EXCEEDED` | 429 | `RateLimitError` | Client exceeded request quota |
| `SERVICE_UNAVAILABLE` | 503 | `ServiceUnavailableError` | Dependency (DB, Redis) unreachable |
| `INTERNAL_ERROR` | 500 | `InternalError` | Unhandled programmer error |

---

## 4. Global Error Handler Middleware

The global error handler is the **last Express middleware** registered in `app.ts`. All unhandled errors in the request pipeline arrive here via `next(err)` (from `asyncWrapper`) or thrown synchronously.

```typescript
// shared/middleware/error-handler.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { BaseError, InternalError, ValidationError } from '@/shared/errors';
import { logger } from '@/shared/logger';

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction, // Must be declared even if unused — Express requires 4 args
): void {
  const requestId = req.headers['x-request-id'] as string | undefined;

  // Normalize to BaseError
  const appError: BaseError = err instanceof BaseError
    ? err
    : new InternalError('An unexpected error occurred', err);

  // Log with structured context
  const logLevel = appError.isOperational ? 'warn' : 'error';
  logger[logLevel]({
    err: {
      name: appError.name,
      message: appError.message,
      code: appError.code,
      statusCode: appError.statusCode,
      // Stack only logged server-side, never sent to client
      stack: appError.stack,
    },
    requestId,
    method: req.method,
    path: req.path,
    userId: req.user?.userId,
  }, `[${appError.code}] ${appError.message}`);

  // Signal process manager on non-operational errors
  if (!appError.isOperational) {
    process.emit('uncaughtException', appError as unknown as Error);
  }

  // Shape the client response
  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      // Field errors only for ValidationError
      ...(appError instanceof ValidationError && {
        fields: appError.fieldErrors,
      }),
      // Retry-After only for rate limit
      ...(appError instanceof RateLimitError && {
        retryAfter: appError.retryAfterSeconds,
      }),
    },
  };

  res.status(appError.statusCode).json(body);
}
```

Register it last in `app.ts`:

```typescript
// app.ts
app.use(router);
app.use(notFoundHandler);   // catches 404 for unknown routes
app.use(globalErrorHandler); // catches all errors
```

---

## 5. Async Error Wrapper

Eliminates `try/catch` boilerplate in every controller method and pipes errors to `next()` automatically.

```typescript
// shared/utils/async-wrapper.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/**
 * Wraps an async Express handler, forwarding any thrown errors to the next()
 * error-handling middleware. Eliminates boilerplate try/catch in controllers.
 *
 * @example
 * router.get('/projects', asyncWrapper(async (req, res) => {
 *   const projects = await projectService.list(req.user.orgId);
 *   res.json({ success: true, data: projects });
 * }));
 */
export function asyncWrapper(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
```

---

## 6. Validation Error Formatting

Zod errors are rich structured objects. The `formatZodError` utility converts them to SELADEV's `FieldError[]` contract.

```typescript
// shared/utils/format-zod-error.ts
import type { ZodError } from 'zod';
import type { FieldError } from '@seladev/schemas';

/**
 * Converts a ZodError into the SELADEV FieldError array format.
 * Dot-path notation is used for nested fields: "config.timeout"
 */
export function formatZodError(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
    code: issue.code,
  }));
}

// In validation middleware:
const result = schema.safeParse(req.body);
if (!result.success) {
  throw new ValidationError(formatZodError(result.error));
}
```

---

## 7. MongoDB Error Handling

Mongoose surfaces MongoDB driver errors. These must be mapped to SELADEV operational errors in the service layer — never let raw Mongoose errors reach the global handler.

### E11000 Duplicate Key

```typescript
// shared/utils/mongoose-errors.ts
import type { MongoError } from 'mongodb';

export function isMongooseDuplicateKeyError(err: unknown): err is MongoError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as MongoError).code === 11000
  );
}

// Usage in service:
try {
  await this.projectRepo.create(data);
} catch (err) {
  if (isMongooseDuplicateKeyError(err)) {
    // Extract the duplicate field from err.keyValue
    const field = Object.keys((err as any).keyValue ?? {})[0] ?? 'field';
    throw new ConflictError(`A project with this ${field} already exists`);
  }
  throw err;
}
```

### Connection Errors

MongoDB connection errors are handled at the application bootstrap level, not in individual queries.

```typescript
// shared/database/mongoose.ts
mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'MongoDB connection error');
  // Do not throw here — mongoose will attempt reconnection automatically
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected — attempting to reconnect');
});

// During a request when the connection is unavailable:
// Mongoose will throw a MongoNetworkError — catch in global handler as ServiceUnavailableError
export function isMongooseConnectionError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'MongoNetworkError' || err.name === 'MongoServerSelectionError')
  );
}
```

In the global error handler, add a check before the `BaseError` normalization:

```typescript
if (isMongooseConnectionError(err)) {
  appError = new ServiceUnavailableError('Database');
}
```

---

## 8. BullMQ Job Failure Handling

BullMQ job failures are not HTTP errors — they're captured by the worker process. Each worker should attach an error handler and log structured failure context.

```typescript
// features/deployments/deployment.worker.ts
import { Worker } from 'bullmq';
import { logger } from '@/shared/logger';
import { deploymentQueue } from './deployment.queue';

const worker = new Worker(
  deploymentQueue.name,
  async (job) => {
    // Job processor — throws on failure
    await runDeploymentPipeline(job.data);
  },
  {
    connection: redisConnection,
    concurrency: config.worker.concurrency,
  },
);

worker.on('failed', (job, err) => {
  logger.error({
    jobId: job?.id,
    jobName: job?.name,
    attempt: job?.attemptsMade,
    data: job?.data,
    err: {
      message: err.message,
      stack: err.stack,
    },
  }, 'BullMQ job failed');

  // After maxAttempts, job moves to the dead letter queue automatically
  // SELADEV monitors DLQ via the DeploymentService.handleDeadLetter() method
});

worker.on('error', (err) => {
  // Worker-level error (e.g., Redis disconnection)
  logger.error({ err }, 'BullMQ worker error');
});
```

**Dead Letter Queue** — Jobs that exceed `maxAttempts` (default: 3) are moved to the failed jobs store. SELADEV polls this in `deployment.service.ts` and transitions the deployment record to `FAILED` status, triggering a webhook event and notification.

---

## 9. Unhandled Rejection and Uncaught Exception Handling

Registered once in `apps/api/src/index.ts`, before any other code runs.

```typescript
// index.ts
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({
    reason,
    promise,
  }, 'Unhandled Promise Rejection — process will exit');
  // Force crash — let the process manager (PM2, Docker restart policy) recover
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception — process will exit');
  // Synchronous logging before exit (pino uses sync transport in this case)
  process.exit(1);
});

// Graceful shutdown on SIGTERM (sent by Docker/Kubernetes)
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — graceful shutdown initiated');
  await server.close();
  await mongoose.connection.close();
  await redisClient.quit();
  process.exit(0);
});
```

> **Why `process.exit(1)` on unhandled rejection?** Node.js has deprecated the default warning-only behavior. An unhandled rejection often signals a corrupted state. Crashing fast and restarting is safer than continuing in an unknown state. Docker's `restart: unless-stopped` and BullMQ's worker restart semantics handle recovery.

---

## 10. Error Logging Strategy

### What to Log

| Field | Always | Only on Error |
|---|---|---|
| `requestId` | ✓ | |
| `method` + `path` | ✓ | |
| `userId` (if authenticated) | ✓ | |
| `err.name` | | ✓ |
| `err.message` | | ✓ |
| `err.code` | | ✓ |
| `err.statusCode` | | ✓ |
| `err.stack` | | ✓ (server-side only) |
| `err.details` | | ✓ (if non-sensitive) |

### What NOT to Log

- Passwords, password hashes
- JWT tokens (access or refresh)
- API keys (raw value)
- Encryption keys or IVs
- Credit card or PII data
- Full request bodies for auth endpoints (log only `email`, never `password`)

### Log Levels

| Level | When to Use |
|---|---|
| `trace` | Very fine-grained debug info (disabled in production) |
| `debug` | Diagnostic info for development |
| `info` | Normal operational events (request start/end, job queued) |
| `warn` | Operational errors (ValidationError, NotFoundError, ForbiddenError) |
| `error` | Unexpected errors that may affect functionality |
| `fatal` | Uncaught exceptions, unhandled rejections — process will exit |

SELADEV uses [pino](https://github.com/pinojs/pino) for structured JSON logging. Log level is set via the `LOG_LEVEL` environment variable, defaulting to `info` in production.

---

## 11. Request ID Correlation

Every inbound HTTP request is assigned a unique `requestId` that flows through logs, error responses, and (optionally) downstream service calls.

```typescript
// shared/middleware/request-id.middleware.ts
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Honor upstream request ID (e.g., from API gateway, load balancer)
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}
```

The `requestId` is included in:
1. The `X-Request-ID` response header
2. The `error.requestId` field in error response bodies
3. Every structured log line via pino's `req` serializer

---

## 12. Frontend Error Handling

### Axios Interceptor — Error Normalization

```typescript
// apps/web/src/lib/api-client.ts
import axios from 'axios';
import type { AppError } from '@seladev/schemas';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true, // send refresh token cookie
});

// Response interceptor — normalize API errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 401 + token expired → attempt token refresh
    if (
      error.response?.status === 401 &&
      error.response?.data?.error?.code === 'TOKEN_EXPIRED' &&
      !originalRequest._retried
    ) {
      originalRequest._retried = true;
      try {
        await apiClient.post('/auth/refresh');
        return apiClient(originalRequest);
      } catch {
        // Refresh failed — redirect to login
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    // Normalize error shape for consistent consumption in components
    const appError: AppError = {
      code: error.response?.data?.error?.code ?? 'NETWORK_ERROR',
      message: error.response?.data?.error?.message ?? 'An unexpected error occurred',
      requestId: error.response?.data?.error?.requestId,
      fields: error.response?.data?.error?.fields,
      status: error.response?.status ?? 0,
    };

    return Promise.reject(appError);
  },
);
```

### React Error Boundary

```typescript
// apps/web/src/components/ErrorBoundary.tsx
import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to error tracking (Sentry in future)
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
```

### TanStack Query Error Handling

```typescript
// apps/web/src/features/projects/hooks/useProject.ts
import { useQuery } from '@tanstack/react-query';
import type { AppError } from '@seladev/schemas';

export function useProject(projectId: string) {
  return useQuery<ProjectDto, AppError>({
    queryKey: ['projects', projectId],
    queryFn: () => fetchProject(projectId),
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors — they won't resolve with a retry
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
```

---

## 13. Sensitive Data in Errors

**Never expose to the client:**
- Stack traces
- MongoDB query paths or field names (e.g., `users.passwordHash`)
- Internal service names or IP addresses
- Raw Mongoose/MongoDB error messages
- File system paths
- Environment variable names or values

**Envelope pattern** — The `BaseError.details` field is used internally for structured context but is **never serialized to the client response body**. Only `code`, `message`, `requestId`, and `fields` (for validation) are sent.

```typescript
// In global error handler — this is WRONG:
res.json({ error: appError }); // Exposes .stack, .details, internal paths

// CORRECT — only allow-listed fields
res.json({
  success: false,
  error: {
    code: appError.code,
    message: appError.message,
    requestId,
    ...(appError instanceof ValidationError && { fields: appError.fieldErrors }),
  },
});
```

For `InternalError` (500), the message sent to the client is always the generic string `"An unexpected error occurred"`, regardless of the actual error message, which is only logged server-side.

```typescript
const clientMessage = appError.isOperational
  ? appError.message
  : 'An unexpected error occurred'; // Never expose InternalError details
```

---

## 14. Future: Error Tracking Integration

When SELADEV is production-ready for a hosted offering, integrate Sentry for error tracking:

```typescript
// Planned integration — not yet implemented
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: config.sentry.dsn,
  environment: config.server.nodeEnv,
  // Only capture non-operational errors (programmer errors)
  beforeSend(event) {
    const err = event.exception?.values?.[0];
    if (err?.value?.includes('isOperational')) return null; // suppress operational
    return event;
  },
});

// In global error handler, after logging:
if (!appError.isOperational) {
  Sentry.withScope((scope) => {
    scope.setTag('requestId', requestId ?? 'unknown');
    scope.setUser({ id: req.user?.userId });
    Sentry.captureException(appError);
  });
}
```

---

## Decisions

1. **`isOperational` flag** — Borrowed from the [Joyent error handling guide](https://www.joyent.com/node-js/production/design/errors). This single boolean lets the global handler decide whether to attempt recovery (operational) or crash (programmer error) without needing `instanceof` checks for every error type.

2. **Abstract `BaseError`** — Making `BaseError` abstract ensures no one can instantiate it directly. Every error thrown must be a concrete, semantically meaningful subclass with a defined `statusCode` and `code`.

3. **Stable error codes** — Error codes like `TOKEN_EXPIRED` are stable strings that never change. This allows frontend code and API consumers to branch on `error.code` without fear of regression. HTTP status codes are insufficient for this (multiple error types share 401).

4. **Request ID in every error** — The `requestId` ties a client-reported error to a specific log line, making support triage deterministic.

## Tradeoffs

- **Global handler catches everything** — This means controllers must never call `res.json()` after throwing, or the response will be sent twice. The `asyncWrapper` pattern prevents this, but it requires discipline.
- **`process.exit(1)` on unhandled rejection** — Aggressive, but correct. The alternative (warn and continue) leads to zombie processes in unknown states. Docker and PM2 restart policies make this safe.
- **Validation error detail level** — We expose field-level error paths (e.g., `"config.timeout"`). This helps developers building integrations but could theoretically reveal schema structure. Acceptable tradeoff for DX.

## Future Improvements

- **Sentry / Datadog APM** integration for non-operational error tracking with traces.
- **Error budget tracking** — Track operational error rates per endpoint to catch regressions.
- **Structured error codes in OpenAPI spec** — Enumerate error codes per endpoint in the Swagger spec for generated SDK error handling.
- **Circuit breaker pattern** — Use `opossum` to wrap external service calls and automatically surface `ServiceUnavailableError` when a dependency degrades.
