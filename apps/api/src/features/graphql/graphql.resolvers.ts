import { GraphQLScalarType, Kind } from 'graphql';
import mongoose from 'mongoose';
import { pubsub, DEPLOYMENT_STATUS_CHANGED, DEPLOYMENT_LOG_ADDED } from './graphql.pubsub';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { ProjectModel } from '../../infrastructure/database/models/project.model';
import { EnvironmentModel } from '../../infrastructure/database/models/environment.model';
import { DeploymentModel } from '../../infrastructure/database/models/deployment.model';
import { withFilter } from 'graphql-subscriptions';

// Helper to assert user is authenticated
function requireUser(context: any) {
  if (!context.user) {
    throw new UnauthorizedError('Authentication required', 'AUTH_REQUIRED');
  }
  return context.user;
}

// Helper to verify org-level access
function verifyOrgAccess(user: any, orgId: string) {
  if (user.orgId !== orgId && user.role !== 'owner' && user.role !== 'admin') {
    throw new ForbiddenError('You do not have access to this organization');
  }
}

// Helper to verify project-level access
async function verifyProjectAccess(user: any, projectId: string, requiredRole?: 'admin' | 'developer' | 'viewer') {
  if (user.role === 'owner' || user.role === 'admin') {
    return; // Org admin/owner has full access
  }

  const ProjectMember = mongoose.model('ProjectMember');
  const membership = await ProjectMember.findOne({
    projectId: new mongoose.Types.ObjectId(projectId),
    userId: new mongoose.Types.ObjectId(user.id),
  }).exec();

  if (!membership) {
    throw new ForbiddenError('You are not a member of this project');
  }

  if (requiredRole) {
    const PROJECT_ROLE_RANKS: Record<string, number> = { admin: 30, developer: 20, viewer: 10, none: 0 };
    const userRank = PROJECT_ROLE_RANKS[membership.role] || 0;
    const requiredRank = PROJECT_ROLE_RANKS[requiredRole] || 0;
    if (userRank < requiredRank) {
      throw new ForbiddenError(`You do not have the required project role (${requiredRole})`);
    }
  }
}

// Resolve user's project role dynamically
async function getProjectRole(user: any, projectId: string): Promise<string> {
  if (user.role === 'owner' || user.role === 'admin') {
    return 'admin';
  }
  const ProjectMember = mongoose.model('ProjectMember');
  const membership = await ProjectMember.findOne({
    projectId: new mongoose.Types.ObjectId(projectId),
    userId: new mongoose.Types.ObjectId(user.id),
  }).exec();
  return membership ? membership.role : 'none';
}

export const resolvers = {
  DateTime: new GraphQLScalarType({
    name: 'DateTime',
    description: 'DateTime custom scalar type',
    serialize(value: any) {
      return value instanceof Date ? value.toISOString() : value;
    },
    parseValue(value: any) {
      return new Date(value);
    },
    parseLiteral(ast) {
      if (ast.kind === Kind.STRING) {
        return new Date(ast.value);
      }
      return null;
    },
  }),

  Query: {
    projects: async (_parent: any, { orgId }: { orgId: string }, context: any) => {
      const user = requireUser(context);
      verifyOrgAccess(user, orgId);
      return context.services.projectsService.listProjects(orgId);
    },

    project: async (_parent: any, { id }: { id: string }, context: any) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(id);
      if (!project) return null;
      verifyOrgAccess(user, project.organizationId.toString());
      return project;
    },

    environment: async (_parent: any, { id }: { id: string }, context: any) => {
      const user = requireUser(context);
      const env = await EnvironmentModel.findById(id).exec();
      if (!env) return null;
      
      const project = await ProjectModel.findById(env.projectId).exec();
      if (!project) throw new NotFoundError('Project', env.projectId.toString());
      
      verifyOrgAccess(user, project.organizationId.toString());
      await verifyProjectAccess(user, project.id);
      return env;
    },

    secrets: async (
      _parent: any,
      { projectId, environmentId }: { projectId: string; environmentId: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());

      // Populate projectRole for SecretsService
      const projectRole = await getProjectRole(user, projectId);
      const secretsUser = { ...user, projectRole };

      return context.services.secretsService.listSecrets(secretsUser, projectId, environmentId);
    },

    revealSecret: async (
      _parent: any,
      { projectId, secretId }: { projectId: string; secretId: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());

      // Populate projectRole for SecretsService
      const projectRole = await getProjectRole(user, projectId);
      const secretsUser = { ...user, projectRole };

      return context.services.secretsService.revealSecret(secretsUser, projectId, secretId, context.clientContext);
    },

    deployments: async (
      _parent: any,
      { projectId, limit, cursor }: { projectId: string; limit?: number; cursor?: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());
      await verifyProjectAccess(user, projectId);

      return context.services.deploymentsService.listHistory(user, projectId, limit || 20, cursor);
    },

    deployment: async (_parent: any, { id }: { id: string }, context: any) => {
      const user = requireUser(context);
      const deployment = await DeploymentModel.findById(id).exec();
      if (!deployment) return null;

      verifyOrgAccess(user, deployment.organizationId.toString());
      await verifyProjectAccess(user, deployment.projectId.toString());
      return deployment;
    },

    auditLogs: async (
      _parent: any,
      { orgId, limit, cursor }: { orgId: string; limit?: number; cursor?: string },
      context: any
    ) => {
      const user = requireUser(context);
      verifyOrgAccess(user, orgId);

      // Audit logs restricted to org admin/owner
      if (user.role !== 'owner' && user.role !== 'admin') {
        throw new ForbiddenError('Only organization administrators can access audit logs');
      }

      return context.services.auditLogsService.listHistory(user, orgId, {}, limit || 20, cursor);
    },
  },

  Mutation: {
    createProject: async (
      _parent: any,
      { orgId, name, slug, description }: { orgId: string; name: string; slug: string; description?: string },
      context: any
    ) => {
      const user = requireUser(context);
      verifyOrgAccess(user, orgId);

      // Only org admin/owner/member can create projects
      if (user.role === 'viewer') {
        throw new ForbiddenError('Viewers are not allowed to create projects');
      }

      return context.services.projectsService.createProject(
        user.id,
        orgId,
        { name, slug, description },
        context.clientContext
      );
    },

    createSecret: async (
      _parent: any,
      {
        projectId,
        environmentId,
        key,
        value,
        expiresAt,
      }: { projectId: string; environmentId: string; key: string; value: string; expiresAt?: Date },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());

      // Populate projectRole for SecretsService
      const projectRole = await getProjectRole(user, projectId);
      const secretsUser = { ...user, projectRole };

      return context.services.secretsService.createSecret(
        secretsUser,
        projectId,
        environmentId,
        key,
        value,
        expiresAt,
        context.clientContext
      );
    },

    triggerDeployment: async (
      _parent: any,
      {
        projectId,
        environmentId,
        branch,
        commitSha,
        commitMessage,
      }: { projectId: string; environmentId: string; branch: string; commitSha?: string; commitMessage?: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());
      await verifyProjectAccess(user, projectId, 'developer');

      return context.services.deploymentsService.triggerDeployment(
        user,
        projectId,
        environmentId,
        branch,
        commitSha || null,
        commitMessage || null,
        context.clientContext
      );
    },

    approveDeployment: async (
      _parent: any,
      { projectId, deploymentId }: { projectId: string; deploymentId: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());

      return context.services.deploymentsService.approveDeployment(
        user,
        projectId,
        deploymentId,
        context.clientContext
      );
    },

    rejectDeployment: async (
      _parent: any,
      { projectId, deploymentId }: { projectId: string; deploymentId: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());

      return context.services.deploymentsService.rejectDeployment(
        user,
        projectId,
        deploymentId,
        context.clientContext
      );
    },

    cancelDeployment: async (
      _parent: any,
      { projectId, deploymentId }: { projectId: string; deploymentId: string },
      context: any
    ) => {
      const user = requireUser(context);
      const project = await context.services.projectsService.getProject(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      verifyOrgAccess(user, project.organizationId.toString());

      return context.services.deploymentsService.cancelDeployment(
        user,
        projectId,
        deploymentId,
        context.clientContext
      );
    },
  },

  Subscription: {
    deploymentStatusChanged: {
      subscribe: withFilter(
        () => (pubsub as any).asyncIterableIterator([DEPLOYMENT_STATUS_CHANGED]),
        async (payload, variables, context) => {
          const user = context.user;
          if (!user) return false;
          
          const deployment = payload.deploymentStatusChanged;
          if (deployment.projectId.toString() !== variables.projectId) {
            return false;
          }

          try {
            verifyOrgAccess(user, deployment.organizationId.toString());
            await verifyProjectAccess(user, variables.projectId);
            return true;
          } catch {
            return false;
          }
        }
      ),
    },

    deploymentLogAdded: {
      subscribe: withFilter(
        () => (pubsub as any).asyncIterableIterator([DEPLOYMENT_LOG_ADDED]),
        async (payload, variables, context) => {
          const user = context.user;
          if (!user) return false;

          const { deploymentId } = payload;
          if (deploymentId !== variables.deploymentId) {
            return false;
          }

          try {
            const deployment = await DeploymentModel.findById(deploymentId).exec();
            if (!deployment) return false;

            verifyOrgAccess(user, deployment.organizationId.toString());
            await verifyProjectAccess(user, deployment.projectId.toString());
            return true;
          } catch {
            return false;
          }
        }
      ),
      resolve: (payload: any) => payload.logLine,
    },
  },

  Project: {
    environments: async (project: any, _args: any, context: any) => {
      return context.loaders.environmentLoader.loadMany(
        project.environments ? project.environments.map((e: any) => e._id.toString()) : []
      );
    },
    members: async (project: any, _args: any, context: any) => {
      return context.services.projectsService.listMembers(project.id);
    },
  },

  Environment: {
    secrets: async (env: any, _args: any, context: any) => {
      const user = requireUser(context);
      
      // Populate projectRole for SecretsService
      const projectRole = await getProjectRole(user, env.projectId.toString());
      const secretsUser = { ...user, projectRole };

      return context.services.secretsService.listSecrets(secretsUser, env.projectId.toString(), env.id);
    },
  },

  ProjectMember: {
    user: async (member: any, _args: any, context: any) => {
      return context.loaders.userLoader.load(member.userId.toString());
    },
  },

  Deployment: {
    project: async (deployment: any, _args: any, context: any) => {
      return context.loaders.projectLoader.load(deployment.projectId.toString());
    },
    environment: async (deployment: any, _args: any, context: any) => {
      return context.loaders.environmentLoader.load(deployment.environmentId.toString());
    },
  },
};
