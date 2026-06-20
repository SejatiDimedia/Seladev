export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational: boolean;
  readonly timestamp: string;

  constructor(message: string, isOperational = true, public readonly details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends BaseError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor(resourceName: string, identifier?: string | number) {
    super(
      identifier ? `${resourceName} with identifier "${identifier}" not found` : `${resourceName} not found`,
      true
    );
  }
}

export class UnauthorizedError extends BaseError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';

  constructor(message = 'Authentication required', code = 'AUTH_REQUIRED') {
    super(message, true);
    (this as any).code = code; // allow dynamic codes like TOKEN_EXPIRED, TOKEN_INVALID
  }
}

export class ForbiddenError extends BaseError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';

  constructor(message = 'Forbidden') {
    super(message, true);
  }
}

export class ConflictError extends BaseError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message, true);
  }
}

export interface FieldError {
  field: string;
  message: string;
  code: string;
}

export class ValidationError extends BaseError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';

  constructor(public readonly fieldErrors: FieldError[], message = 'Request validation failed') {
    super(message, true, { fields: fieldErrors });
  }
}

export class RateLimitError extends BaseError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(public readonly retryAfterSeconds: number, message = 'Too many requests. Please slow down.') {
    super(message, true);
  }
}

export class ServiceUnavailableError extends BaseError {
  readonly statusCode = 503;
  readonly code = 'SERVICE_UNAVAILABLE';

  constructor(service: string, message?: string) {
    super(message ?? `${service} is temporarily unavailable. Please try again shortly.`, true);
  }
}

export class InternalError extends BaseError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_ERROR';
  readonly cause?: unknown;

  constructor(message = 'An unexpected error occurred', cause?: unknown) {
    super(message, false); // isOperational = false
    if (cause) {
      this.cause = cause;
    }
  }
}
