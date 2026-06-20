import type { Request, Response, NextFunction, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { verifyAccessToken } from '../lib/jwt';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';
import { getRedisClient } from '../config/redis';
import crypto from 'crypto';

function checkApiKeyScope(method: string, path: string, scopes: string[]): boolean {
  const methodUpper = method.toUpperCase();
  const normalizedPath = path.toLowerCase();

  if (
    normalizedPath.includes('/secrets') ||
    normalizedPath.includes('/reveal') ||
    normalizedPath.includes('/rollback') ||
    normalizedPath.includes('/versions')
  ) {
    if (methodUpper === 'GET' && !normalizedPath.includes('/reveal')) {
      return scopes.includes('secrets:read');
    }
    if (normalizedPath.includes('/reveal')) {
      return scopes.includes('secrets:read');
    }
    return scopes.includes('secrets:write');
  }

  if (normalizedPath.includes('/deployments')) {
    if (methodUpper === 'GET') {
      return scopes.includes('deployments:read');
    }
    return scopes.includes('deployments:write') || scopes.includes('deployments:trigger');
  }

  if (normalizedPath.includes('/webhooks')) {
    if (methodUpper === 'GET') {
      return scopes.includes('webhooks:read');
    }
    return scopes.includes('webhooks:write');
  }

  if (normalizedPath.includes('/projects')) {
    if (methodUpper === 'GET') {
      return scopes.includes('projects:read');
    }
  }

  if (normalizedPath.includes('/members')) {
    if (methodUpper === 'GET') {
      return scopes.includes('members:read');
    }
  }

  if (normalizedPath.includes('/api-keys')) {
    if (methodUpper === 'GET') {
      return scopes.includes('api-keys:read');
    }
  }

  if (normalizedPath.includes('/audit-logs') || normalizedPath.includes('/audit')) {
    if (methodUpper === 'GET') {
      return scopes.includes('audit-logs:read');
    }
  }

  return true;
}

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

  // 1. Check if token is an API Key
  if (token.startsWith('sdv_sk_')) {
    try {
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');

      // Dynamically resolve ApiKey model to avoid circular import dependency
      const ApiKey = mongoose.model('ApiKey');
      const apiKey = await ApiKey.findOne({ keyHash }).exec();

      if (!apiKey) {
        next(new UnauthorizedError('Invalid API key', 'API_KEY_INVALID'));
        return;
      }
      if (!apiKey.isActive) {
        next(new UnauthorizedError('API key is deactivated', 'API_KEY_INVALID'));
        return;
      }
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        next(new UnauthorizedError('API key has expired', 'API_KEY_INVALID'));
        return;
      }

      // Fire-and-forget lastUsedAt update
      apiKey.lastUsedAt = new Date();
      apiKey.save().catch((err: any) => console.error('Failed to update API key lastUsedAt:', err));

      // Resolve the owner's role in the organization
      const Membership = mongoose.model('Membership');
      const membership = await Membership.findOne({
        organizationId: apiKey.organizationId,
        userId: apiKey.userId,
      }).exec();

      const userOrgRole = membership ? membership.role : 'none';

      // Attach API key context payload
      (req as any).user = {
        id: apiKey.userId.toString(),
        role: userOrgRole,
        orgId: apiKey.organizationId.toString(),
        apiKeyId: apiKey._id.toString(),
        apiKeyScopes: apiKey.scopes,
        apiKeyProjectId: apiKey.projectId ? apiKey.projectId.toString() : null,
        apiKeyEnvironmentId: apiKey.environmentId ? apiKey.environmentId.toString() : null,
      };

      // Enforce API Key scope boundaries
      const isAllowed = checkApiKeyScope(req.method, req.path, apiKey.scopes);
      if (!isAllowed) {
        next(new ForbiddenError('API key missing required scope for this action'));
        return;
      }

      // Enforce Project scoping boundary if projectId is present in request context
      if (apiKey.projectId) {
        const projectIdMatch = req.originalUrl.match(/\/projects\/([0-9a-fA-F]{24})/);
        const projectIdParam = projectIdMatch ? projectIdMatch[1] : req.params.projectId;
        if (projectIdParam && projectIdParam !== apiKey.projectId.toString()) {
          next(new ForbiddenError('API key is scoped to a different project'));
          return;
        }
      }

      next();
      return;
    } catch (err) {
      next(new UnauthorizedError('API key authentication failed', 'API_KEY_INVALID'));
      return;
    }
  }

  // 2. Standard JWT Authentication flow
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

    // Org-level MFA enforcement check
    const isAuthRoute = req.originalUrl.includes('/api/v1/auth');
    if (!isAuthRoute && payload.orgId) {
      try {
        const Organization = mongoose.model('Organization');
        const org = await Organization.findById(payload.orgId).exec();
        if (org && org.settings?.mfaRequired) {
          const User = mongoose.model('User');
          const dbUser = await User.findById(payload.sub).exec();
          if (dbUser && !dbUser.mfaEnabled) {
            const forbiddenError = new ForbiddenError('MFA setup is required by this organization');
            (forbiddenError as any).code = 'MFA_REQUIRED';
            next(forbiddenError);
            return;
          }
        }
      } catch (dbError) {
        console.error('⚠️ MFA enforcement check failed:', dbError);
      }
    }

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      next(new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED'));
    } else {
      next(new UnauthorizedError('Invalid authentication token', 'TOKEN_INVALID'));
    }
  }
};
