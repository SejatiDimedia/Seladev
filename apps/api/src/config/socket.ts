import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { config } from './index';

let io: Server | null = null;

export function getSocketServer(): Server {
  if (!io) {
    throw new Error('Socket.IO has not been initialized. Call initSocketServer() first.');
  }
  return io;
}

export function initSocketServer(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for local development, restrict in production if needed
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    if (config.server.isDevelopment) {
      console.log(`🔌 Client connected: ${socket.id}`);
    }

    socket.on('disconnect', () => {
      if (config.server.isDevelopment) {
        console.log(`🔌 Client disconnected: ${socket.id}`);
      }
    });
  });

  console.log('💚 Socket.IO server initialized');
  return io;
}
