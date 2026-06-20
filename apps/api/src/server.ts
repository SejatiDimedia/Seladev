import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { initSocketServer } from './config/socket';
import { startAllWorkers, stopAllWorkers } from './workers';

async function startServer(): Promise<void> {
  const port = config.server.port;

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

    // 5.1 Start BullMQ Workers
    startAllWorkers();

    // 6. Start listening
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
