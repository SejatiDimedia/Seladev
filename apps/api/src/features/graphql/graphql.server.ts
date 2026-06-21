import { ApolloServer } from '@apollo/server';
import { typeDefs } from './graphql.schema';
import { resolvers } from './graphql.resolvers';
import { depthLimitRule } from './graphql.security';
import { createGraphQLDataLoaders } from './graphql.dataloaders';
import { authenticateToken } from '../../middleware/authenticate-jwt';
import { config } from '../../config';
import type { GraphQLContext } from './graphql.types';

export function createApolloServer(): ApolloServer<GraphQLContext> {
  const isProduction = config.server.env === 'production';

  return new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    introspection: !isProduction,
    validationRules: [depthLimitRule(5)],
  });
}

export async function buildGraphQLContext(
  connectionParams?: any,
  req?: any
): Promise<GraphQLContext> {
  const loaders = createGraphQLDataLoaders();
  const clientContext = {
    ipAddress: req ? req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || null : null,
    userAgent: req ? req.headers['user-agent'] || null : null,
  };

  let token: string | undefined;

  // 1. Try to extract token from WebSocket connectionParams
  if (connectionParams) {
    const auth = connectionParams.Authorization || connectionParams.authToken || connectionParams.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      token = auth.split(' ')[1];
    } else if (typeof auth === 'string') {
      token = auth;
    }
  }

  // 2. Try to extract token from HTTP Authorization header
  if (!token && req && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return { loaders, clientContext };
  }

  try {
    const user = await authenticateToken(token);
    return {
      user,
      loaders,
      clientContext,
    };
  } catch (error) {
    // Return loaders and client context but no user if token is invalid
    return { loaders, clientContext };
  }
}
