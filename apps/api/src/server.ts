import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { initSocketServer } from './config/socket';
import { startAllWorkers, stopAllWorkers } from './workers';

// GraphQL Imports
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { 
  typeDefs, 
  resolvers, 
  depthLimitRule, 
  buildGraphQLContext 
} from './features/graphql';
import type { GraphQLContext } from './features/graphql';

async function startServer(): Promise<void> {
  const port = config.server.port;

  let apolloServerInstance: ApolloServer<GraphQLContext> | null = null;
  let serverCleanupInstance: any = null;

  try {
    // 1. Connect to Database (MongoDB)
    await connectDatabase();

    // 2. Connect to Cache (Redis)
    await connectRedis();

    // 3. Create Express Application
    const app = createApp();

    // 4. Create HTTP Server
    const server = http.createServer(app);

    // 5. Initialize Socket.IO Server
    initSocketServer(server);

    // 6. Setup GraphQL (Apollo Server + WebSocket Subscriptions)
    console.log('⚡ Initializing GraphQL Server...');
    const schema = makeExecutableSchema({ typeDefs, resolvers });

    // WebSocket Server for subscriptions
    const wsServer = new WebSocketServer({
      server,
      path: '/graphql',
    });

    const serverCleanup = useServer(
      {
        schema,
        context: async (ctx: any) => {
          return buildGraphQLContext(ctx.connectionParams);
        },
      },
      wsServer
    );
    serverCleanupInstance = serverCleanup;

    // Create Apollo Server
    const apolloServer = new ApolloServer<GraphQLContext>({
      schema,
      introspection: config.server.env !== 'production',
      validationRules: [depthLimitRule(5)],
      plugins: [
        // HTTP Server shutdown drain
        ApolloServerPluginDrainHttpServer({ httpServer: server }),
        // WebSocket Server shutdown drain
        {
          async serverWillStart() {
            return {
              async drainServer() {
                await serverCleanup.dispose();
              },
            };
          },
        },
      ],
    });
    apolloServerInstance = apolloServer;

    await apolloServer.start();

    // Attach dynamically to the Express app placeholder
    (app as any).graphqlHandler = expressMiddleware(apolloServer, {
      context: async ({ req }: { req: any }) => {
        return buildGraphQLContext(undefined, req);
      },
    });

    console.log('🚀 GraphQL Server initialized at /graphql');

    // 7. Start BullMQ Workers
    startAllWorkers();

    // 8. Start listening
    server.listen(port, () => {
      console.log(`🚀 SELADEV API Control Plane running in ${config.server.env} mode on http://localhost:${port}`);
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n⚠️ Received ${signal}. Starting graceful shutdown...`);

      server.close(() => {
        console.log('💚 HTTP server closed');
      });

      try {
        if (serverCleanupInstance) {
          await serverCleanupInstance.dispose();
          console.log('💚 GraphQL WebSocket server disposed');
        }
        if (apolloServerInstance) {
          await apolloServerInstance.stop();
          console.log('💚 Apollo Server stopped');
        }
        await stopAllWorkers();
        await disconnectRedis();
        await disconnectDatabase();
        console.log('💚 Graceful shutdown complete. Exiting.');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server execution
startServer();
