import type { Request, Response, NextFunction, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

const ORG_ROLE_RANKS: Record<string, number> = {
  owner: 40,
  admin: 30,
  member: 20,
  viewer: 10,
  none: 0,
};

const PROJECT_ROLE_RANKS: Record<string, number> = {
  admin: 30,
  developer: 20,
  viewer: 10,
  none: 0,
};

interface RbacOptions {
  requiredOrgRole?: 'owner' | 'admin' | 'member' | 'viewer';
  requiredProjectRole?: 'admin' | 'developer' | 'viewer';
}

export function authorizeRbac(options: RbacOptions): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;

    if (!user) {
      next(new UnauthorizedError('Authentication required', 'AUTH_REQUIRED'));
      return;
    }

    // 1. Check Organization-Level Role
    if (options.requiredOrgRole) {
      const userOrgRole = user.role || 'none';
      const userOrgRank = ORG_ROLE_RANKS[userOrgRole] || 0;
      const requiredOrgRank = ORG_ROLE_RANKS[options.requiredOrgRole] || 0;

      if (userOrgRank < requiredOrgRank) {
        next(new ForbiddenError('You do not have the required organization role to access this resource'));
        return;
      }
    }

    // 2. Check Project-Level Role (if a projectId is present in params and required project role is set)
    if (options.requiredProjectRole) {
      // Platform Admins/Owners bypass project-level checks (have full project rights)
      const userOrgRole = user.role || 'none';
      if (userOrgRole === 'owner' || userOrgRole === 'admin') {
        next();
        return;
      }

      const projectId = req.params.projectId;
      if (!projectId) {
        // If required project role is set but no projectId is found, this is a programmer error
        next(new ForbiddenError('Project scope is missing from request'));
        return;
      }

      try {
        // Dynamic Mongoose lookup to prevent import circularity
        const ProjectMember = mongoose.model('ProjectMember');
        const projectMemberDoc = await ProjectMember.findOne({
          projectId: new mongoose.Types.ObjectId(projectId),
          userId: new mongoose.Types.ObjectId(user.id),
        }).exec();

        const userProjRole = projectMemberDoc ? projectMemberDoc.role : 'none';
        const userProjRank = PROJECT_ROLE_RANKS[userProjRole] || 0;
        const requiredProjRank = PROJECT_ROLE_RANKS[options.requiredProjectRole] || 0;

        if (userProjRank < requiredProjRank) {
          next(new ForbiddenError('You do not have the required project role to access this resource'));
          return;
        }
      } catch (error) {
        next(new ForbiddenError('Failed to verify project permissions'));
        return;
      }
    }

    next();
  };
}
