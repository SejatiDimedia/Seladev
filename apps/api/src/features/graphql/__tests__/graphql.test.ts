import { describe, it, expect, beforeEach, vi } from 'vitest';
import { graphql, parse, validate } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from '../graphql.schema';
import { resolvers } from '../graphql.resolvers';
import { depthLimitRule } from '../graphql.security';
import { createGraphQLDataLoaders } from '../graphql.dataloaders';
import { pubsub, DEPLOYMENT_STATUS_CHANGED, DEPLOYMENT_LOG_ADDED } from '../graphql.pubsub';


// Mock MongoDB Models to prevent DB calls in unit tests
vi.mock('../../../infrastructure/database/models/project.model', () => ({
  ProjectModel: {
    find: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../../infrastructure/database/models/environment.model', () => ({
  EnvironmentModel: {
    find: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../../infrastructure/database/models/user.model', () => ({
  UserModel: {
    find: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../../infrastructure/database/models/deployment.model', () => ({
  DeploymentModel: {
    find: vi.fn(),
    findById: vi.fn().mockImplementation(() => ({
      exec: async () => ({
        id: 'dep-1',
        projectId: 'proj-1',
        organizationId: 'org-123',
      })
    })),
  },
}));

// Dynamic model registration mock
vi.mock('mongoose', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    model: vi.fn().mockImplementation((name: string) => {
      if (name === 'ProjectMember') {
        return {
          findOne: vi.fn().mockImplementation(({ userId }) => ({
            exec: async () => {
              // Mock: user-1 is admin, user-2 is developer, user-3 is none
              const userIdStr = userId.toString();
              if (userIdStr === 'user-1') return { role: 'admin' };
              if (userIdStr === 'user-2') return { role: 'developer' };
              return null;
            }
          })),
        };
      }
      if (name === 'Deployment') {
        return {
          findById: vi.fn().mockImplementation(() => ({
            exec: async () => ({
              id: 'dep-1',
              projectId: 'proj-1',
              organizationId: 'org-123',
            })
          })),
        };
      }
      return actual.model(name);
    }),
    Types: {
      ObjectId: vi.fn().mockImplementation((id) => id),
    }
  };
});

describe('GraphQL Endpoint (Phase 3.2) Tests', () => {
  let schema: any;
  let mockServices: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    schema = makeExecutableSchema({ typeDefs, resolvers });

    // Mock Services
    mockServices = {
      projectsService: {
        listProjects: vi.fn().mockResolvedValue([
          { id: 'proj-1', name: 'Project 1', slug: 'proj-1', organizationId: 'org-123', visibility: 'private', tags: [] }
        ]),
        getProject: vi.fn().mockResolvedValue({
          id: 'proj-1',
          name: 'Project 1',
          slug: 'proj-1',
          organizationId: 'org-123',
          visibility: 'private',
          tags: [],
        }),
        listMembers: vi.fn().mockResolvedValue([]),
      },
      secretsService: {
        listSecrets: vi.fn().mockResolvedValue([
          { id: 'sec-1', key: 'API_KEY', value: '****', version: 1 }
        ]),
        revealSecret: vi.fn().mockResolvedValue('super-secret-value'),
        createSecret: vi.fn().mockResolvedValue({ id: 'sec-2', key: 'DB_PASSWORD', value: '****', version: 1 }),
      },
      deploymentsService: {
        listHistory: vi.fn().mockResolvedValue({
          edges: [
            {
              node: {
                id: 'dep-1',
                projectId: 'proj-1',
                environmentId: 'env-1',
                version: 1,
                branch: 'main',
                status: 'success',
                triggeredBy: 'user-1',
                triggeredVia: 'ui',
              },
              cursor: 'cursor-1',
            }
          ],
          pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
        }),
        triggerDeployment: vi.fn().mockResolvedValue({
          id: 'dep-2',
          projectId: 'proj-1',
          environmentId: 'env-1',
          version: 2,
          branch: 'main',
          status: 'queued',
          triggeredBy: 'user-1',
          triggeredVia: 'ui',
        }),
      },
      auditLogsService: {
        listHistory: vi.fn().mockResolvedValue({
          edges: [],
          pageInfo: { hasNextPage: false },
        }),
      },
    };

    // Default context for authenticated org admin/owner
    mockContext = {
      user: {
        id: 'user-1',
        email: 'admin@acme.com',
        role: 'admin',
        orgId: 'org-123',
      },
      loaders: createGraphQLDataLoaders(),
      clientContext: { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
      services: mockServices,
    };
  });

  describe('Authentication and Introspection Security', () => {
    it('should reject queries when unauthenticated', async () => {
      const query = `
        query {
          projects(orgId: "org-123") {
            id
            name
          }
        }
      `;

      const result = await graphql({
        schema,
        source: query,
        contextValue: { ...mockContext, user: undefined },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('Authentication required');
    });

    it('should allow queries when authenticated with correct orgId', async () => {
      const query = `
        query {
          projects(orgId: "org-123") {
            id
            name
          }
        }
      `;

      const result = await graphql({
        schema,
        source: query,
        contextValue: mockContext,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data as any;
      expect(data?.projects).toHaveLength(1);
      expect(data?.projects?.[0]?.name).toBe('Project 1');
    });

    it('should block queries for users trying to access another orgId', async () => {
      const query = `
        query {
          projects(orgId: "org-456") {
            id
            name
          }
        }
      `;

      const result = await graphql({
        schema,
        source: query,
        contextValue: {
          ...mockContext,
          user: { id: 'user-1', role: 'member', orgId: 'org-123' },
        },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('You do not have access to this organization');
    });

    it('should block queries that exceed maximum depth limit of 2', async () => {
      const source = `
        query {
          project(id: "proj-1") {
            environments {
              id
            }
          }
        }
      `; // depth: 3 (query -> project -> environments -> id)

      const document = parse(source);
      const rules = [depthLimitRule(2)];
      const validationErrors = validate(schema, document, rules);

      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0]?.message).toContain('Query depth exceeds maximum allowed depth');
    });
  });

  describe('Secrets and Reveal Mutations/Queries', () => {
    it('should retrieve secrets with masked values', async () => {
      const query = `
        query {
          secrets(projectId: "proj-1", environmentId: "env-1") {
            id
            key
            value
          }
        }
      `;

      const result = await graphql({
        schema,
        source: query,
        contextValue: mockContext,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data as any;
      expect(data?.secrets?.[0]?.value).toBe('****');
      expect(mockServices.secretsService.listSecrets).toHaveBeenCalled();
    });

    it('should create a secret successfully via mutation', async () => {
      const mutation = `
        mutation {
          createSecret(projectId: "proj-1", environmentId: "env-1", key: "DB_PASSWORD", value: "db-secret-123") {
            id
            key
            value
          }
        }
      `;

      const result = await graphql({
        schema,
        source: mutation,
        contextValue: mockContext,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data as any;
      expect(data?.createSecret?.key).toBe('DB_PASSWORD');
      expect(mockServices.secretsService.createSecret).toHaveBeenCalled();
    });

    it('should reveal a secret successfully when user has authorization', async () => {
      const query = `
        query {
          revealSecret(projectId: "proj-1", secretId: "sec-1")
        }
      `;

      const result = await graphql({
        schema,
        source: query,
        contextValue: mockContext,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data as any;
      expect(data?.revealSecret).toBe('super-secret-value');
      expect(mockServices.secretsService.revealSecret).toHaveBeenCalled();
    });
  });

  describe('Deployments and Subscriptions', () => {
    it('should trigger a deployment via mutation', async () => {
      const mutation = `
        mutation {
          triggerDeployment(projectId: "proj-1", environmentId: "env-1", branch: "main") {
            id
            status
          }
        }
      `;

      const result = await graphql({
        schema,
        source: mutation,
        contextValue: mockContext,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data as any;
      expect(data?.triggerDeployment?.status).toBe('queued');
      expect(mockServices.deploymentsService.triggerDeployment).toHaveBeenCalled();
    });

    it('should query deployment history successfully', async () => {
      const query = `
        query {
          deployments(projectId: "proj-1", limit: 10) {
            edges {
              node {
                id
                branch
                status
              }
            }
          }
        }
      `;

      const result = await graphql({
        schema,
        source: query,
        contextValue: mockContext,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data as any;
      expect(data?.deployments?.edges).toHaveLength(1);
      expect(data?.deployments?.edges?.[0]?.node?.id).toBe('dep-1');
    });

    it('should successfully subscribe to deploymentStatusChanged and receive events', async () => {
      const subContext = {
        user: { id: 'user-1', role: 'admin', orgId: 'org-123' },
      };

      const subscribeResult: any = await resolvers.Subscription.deploymentStatusChanged.subscribe(
        null,
        { projectId: 'proj-1' },
        subContext as any
      );

      expect(subscribeResult[Symbol.asyncIterator]).toBeDefined();

      const mockEvent = {
        projectId: 'proj-1',
        organizationId: 'org-123',
        status: 'building',
      };
      
      const nextPromise = subscribeResult.next();

      setTimeout(() => {
        pubsub.publish(DEPLOYMENT_STATUS_CHANGED, { deploymentStatusChanged: mockEvent });
      }, 10);

      const iteratorResult = await nextPromise;
      expect(iteratorResult.value).toBeDefined();
      expect(iteratorResult.value.deploymentStatusChanged.status).toBe('building');
    });

    it('should successfully subscribe to deploymentLogAdded and stream logs', async () => {
      const subContext = {
        user: { id: 'user-1', role: 'admin', orgId: 'org-123' },
      };

      const subscribeResult: any = await resolvers.Subscription.deploymentLogAdded.subscribe(
        null,
        { deploymentId: 'dep-1' },
        subContext as any
      );

      expect(subscribeResult[Symbol.asyncIterator]).toBeDefined();

      const nextPromise = subscribeResult.next();

      setTimeout(() => {
        pubsub.publish(DEPLOYMENT_LOG_ADDED, { deploymentId: 'dep-1', logLine: 'Cloning repository...' });
      }, 10);

      const iteratorResult = await nextPromise;
      expect(iteratorResult.value).toBeDefined();
      expect(resolvers.Subscription.deploymentLogAdded.resolve(iteratorResult.value)).toBe('Cloning repository...');
    });
  });
});
