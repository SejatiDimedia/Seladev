import type { Request, Response, NextFunction } from 'express';
import { BaseError, InternalError, ValidationError, RateLimitError } from '../lib/errors';
import { config } from '../config';

const logger = {
  warn: (obj: unknown, msg: string) => {
    console.warn(`⚠️ [WARN] ${msg}`, JSON.stringify(obj));
  },
  error: (obj: unknown, msg: string) => {
    console.error(`❌ [ERROR] ${msg}`, JSON.stringify(obj));
  },
};

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
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
      stack: appError.stack,
    },
    requestId,
    method: req.method,
    path: req.path,
    userId: (req as any).user?.id,
  }, `[${appError.code}] ${appError.message}`);

  // Shape the client response
  const body = {
    success: false as const,
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      ...(appError instanceof ValidationError && {
        fields: appError.fieldErrors,
      }),
      ...(appError instanceof RateLimitError && {
        retryAfter: appError.retryAfterSeconds,
      }),
      // In development/test mode, expose the raw error message if it wasn't operational
      ...(!appError.isOperational && !config.server.isProduction && {
        details: (appError as InternalError).cause instanceof Error 
          ? ((appError as InternalError).cause as Error).message 
          : String((appError as InternalError).cause),
      }),
    },
  };

  res.status(appError.statusCode).json(body);
}
