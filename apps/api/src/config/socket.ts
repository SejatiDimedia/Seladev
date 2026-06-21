import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { config } from './index';
import { verifyAccessToken } from '../lib/jwt';

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

  // Socket.IO Connection Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    // Handle test bypass
    if (config.server.isTest && (!token || token === 'test-token-placeholder')) {
      socket.data = {
        userId: socket.handshake.auth?.userId || 'user-1',
        orgId: socket.handshake.auth?.orgId || 'org-1',
        role: socket.handshake.auth?.role || 'admin',
      };
      return next();
    }

    if (!token) {
      return next(new Error('Authentication error: Token required'));
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data = {
        userId: payload.sub,
        orgId: payload.orgId,
        role: payload.role,
      };
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const orgId = socket.data.orgId;
    if (orgId) {
      socket.join(`org:${orgId}`);
      if (config.server.isDevelopment) {
        console.log(`🔌 Client ${socket.id} joined room org:${orgId}`);
      }
    }

    const userId = socket.data.userId;
    if (userId) {
      socket.join(`user:${userId}`);
      if (config.server.isDevelopment) {
        console.log(`🔌 Client ${socket.id} joined room user:${userId}`);
      }
    }

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
