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

export async function authenticateToken(token: string, method?: string, path?: string): Promise<any> {
  // 1. Check if token is an API Key
  if (token.startsWith('sdv_sk_')) {
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');

    // Dynamically resolve ApiKey model to avoid circular import dependency
    const ApiKey = mongoose.model('ApiKey');
    const apiKey = await ApiKey.findOne({ keyHash }).exec();

    if (!apiKey) {
      throw new UnauthorizedError('Invalid API key', 'API_KEY_INVALID');
    }
    if (!apiKey.isActive) {
      throw new UnauthorizedError('API key is deactivated', 'API_KEY_INVALID');
    }
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedError('API key has expired', 'API_KEY_INVALID');
    }

    // Fire-and-forget lastUsedAt update
    apiKey.lastUsedAt = new Date();
    apiKey.save().catch((err: any) => console.error('Failed to update API key lastUsedAt:', err));

    // Record API Key usage in audit logs asynchronously
    try {
      let resolvedProjectId: string | null = null;
      if (path) {
        const projectIdMatch = path.match(/\/projects\/([0-9a-fA-F]{24})/);
        if (projectIdMatch && projectIdMatch[1]) {
          resolvedProjectId = projectIdMatch[1];
        }
      }
      if (!resolvedProjectId && apiKey.projectId) {
        resolvedProjectId = apiKey.projectId.toString();
      }

      const AuditLog = mongoose.model('AuditLog');
      AuditLog.create({
        organizationId: apiKey.organizationId,
        projectId: resolvedProjectId ? new mongoose.Types.ObjectId(resolvedProjectId) : null,
        actor: {
          userId: apiKey.userId,
          email: 'api-key-system',
          ipAddress: null,
          userAgent: null,
        },
        action: 'apiKey.used',
        resource: {
          type: 'apiKey',
          id: apiKey._id.toString(),
          name: apiKey.name,
        },
        outcome: 'success',
        metadata: {
          keyPrefix: apiKey.keyPrefix,
          path: path || null,
          method: method || null,
        },
      }).catch(() => {
        // Silently catch database errors to prevent API key authentication crash
      });
    } catch (_err) {
      // Silently catch resolver errors
    }

    // Resolve the owner's role in the organization
    const Membership = mongoose.model('Membership');
    const membership = await Membership.findOne({
      organizationId: apiKey.organizationId,
      userId: apiKey.userId,
    }).exec();

    const userOrgRole = membership ? membership.role : 'none';

    const userPayload = {
      id: apiKey.userId.toString(),
      role: userOrgRole,
      orgId: apiKey.organizationId.toString(),
      apiKeyId: apiKey._id.toString(),
      apiKeyScopes: apiKey.scopes,
      apiKeyProjectId: apiKey.projectId ? apiKey.projectId.toString() : null,
      apiKeyEnvironmentId: apiKey.environmentId ? apiKey.environmentId.toString() : null,
    };

    // Enforce API Key scope boundaries if method and path are provided
    if (method && path) {
      const isAllowed = checkApiKeyScope(method, path, apiKey.scopes);
      if (!isAllowed) {
        throw new ForbiddenError('API key missing required scope for this action');
      }

      // Enforce Project scoping boundary if projectId is present in request context
      if (apiKey.projectId) {
        const projectIdMatch = path.match(/\/projects\/([0-9a-fA-F]{24})/);
        if (projectIdMatch && projectIdMatch[1] !== apiKey.projectId.toString()) {
          throw new ForbiddenError('API key is scoped to a different project');
        }
      }
    }

    return userPayload;
  }

  // 2. Standard JWT Authentication flow
  try {
    const payload = verifyAccessToken(token);

    // Check Redis blocklist for revoked access tokens
    try {
      const redis = getRedisClient();
      const isBlocked = await redis.get(`token:blocklist:${payload.jti}`);
      if (isBlocked) {
        throw new UnauthorizedError('Session has been revoked', 'TOKEN_INVALID');
      }
    } catch (redisError) {
      console.warn('⚠️ Redis blocklist unreachable:', redisError);
    }

    return {
      id: payload.sub,
      email: payload.email,
      orgId: payload.orgId,
      role: payload.role,
      jti: payload.jti,
    };
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');
    } else {
      throw new UnauthorizedError('Invalid authentication token', 'TOKEN_INVALID');
    }
  }
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

  try {
    const userPayload = await authenticateToken(token, req.method, req.originalUrl || req.path);
    (req as any).user = userPayload;

    // Org-level MFA enforcement check
    const isAuthRoute = req.originalUrl.includes('/api/v1/auth');
    if (!isAuthRoute && userPayload.orgId) {
      try {
        const Organization = mongoose.model('Organization');
        const org = await Organization.findById(userPayload.orgId).exec();
        if (org && org.settings?.mfaRequired) {
          const User = mongoose.model('User');
          const dbUser = await User.findById(userPayload.id).exec();
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
  } catch (error) {
    next(error);
  }
};

