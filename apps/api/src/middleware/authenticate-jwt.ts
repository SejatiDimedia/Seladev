import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { UnauthorizedError } from '../lib/errors';
import { getRedisClient } from '../config/redis';

export const authenticateJwt: RequestHandler = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new UnauthorizedError('Authentication token required', 'AUTH_REQUIRED'));
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    next(new UnauthorizedError('Malformed authorization header', 'TOKEN_MALFORMED'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);

    // Check Redis blocklist for revoked access tokens
    try {
      const redis = getRedisClient();
      const isBlocked = await redis.get(`token:blocklist:${payload.jti}`);
      if (isBlocked) {
        next(new UnauthorizedError('Session has been revoked', 'TOKEN_INVALID'));
        return;
      }
    } catch (redisError) {
      // In production, we might want to fail-closed or fail-open depending on SLA.
      // For local development, we fail-open and log the warning.
      console.warn('⚠️ Redis blocklist unreachable:', redisError);
    }

    // Attach user payload to Express request (id mapped from sub)
    (req as any).user = {
      id: payload.sub,
      email: payload.email,
      orgId: payload.orgId,
      role: payload.role,
      jti: payload.jti,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      next(new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED'));
    } else {
      next(new UnauthorizedError('Invalid authentication token', 'TOKEN_INVALID'));
    }
  }
};
