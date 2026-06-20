import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { notFoundHandler } from './middleware/not-found';
import { globalErrorHandler } from './middleware/error-handler';
import { config } from './config';

export function createApp(): express.Application {
  const app = express();

  // Request ID middleware (inject simple x-request-id)
  app.use((req, _res, next) => {
    const reqId = req.headers['x-request-id'] || Math.random().toString(36).substring(2, 15);
    req.headers['x-request-id'] = reqId;
    next();
  });

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(cors({
    origin: '*', // Customize in production
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    credentials: true,
  }));

  // Body parsers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request Logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (config.server.env !== 'test') {
        console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms (ID: ${req.headers['x-request-id']})`);
      }
    });
    next();
  });

  // Health check routes
  app.get('/health', (_req, res) => {
    res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      env: config.server.env,
    });
  });

  app.get('/health/ready', (_req, res) => {
    // Basic dependency checks can go here
    res.status(200).json({
      success: true,
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // Root route check
  app.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      message: 'SELADEV API Control Plane is active.',
      version: '1.0.0',
    });
  });

  // Catch 404
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(globalErrorHandler);

  return app;
}
