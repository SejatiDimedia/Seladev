import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { notFoundHandler } from './middleware/not-found';
import { globalErrorHandler } from './middleware/error-handler';
import { config } from './config';

// Features Imports
import { MongooseAuthRepository, AuthService, AuthController, initAuthRoutes } from './features/auth';
import { MongooseOrganizationsRepository, OrganizationsService, OrganizationsController, initOrganizationsRoutes } from './features/organizations';
import { MongooseProjectsRepository, ProjectsService, ProjectsController, initProjectsRoutes } from './features/projects';
import { MongooseSecretsRepository, SecretsService, SecretsController, initSecretsRoutes } from './features/secrets';
import { MongooseApiKeysRepository, ApiKeysService, ApiKeysController, initApiKeysRoutes } from './features/api-keys';


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
  app.use(cookieParser());

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

  // Dependencies Injection
  const authRepo = new MongooseAuthRepository();
  const authService = new AuthService(authRepo);
  const authController = new AuthController(authService);
  const authRoutes = initAuthRoutes(authController);

  const orgRepo = new MongooseOrganizationsRepository();
  const orgService = new OrganizationsService(orgRepo);
  const orgController = new OrganizationsController(orgService);
  const orgRoutes = initOrganizationsRoutes(orgController);

  const projectsRepo = new MongooseProjectsRepository();
  const projectsService = new ProjectsService(projectsRepo, orgRepo);
  const projectsController = new ProjectsController(projectsService);
  const projectsRoutes = initProjectsRoutes(projectsController);

  const secretsRepo = new MongooseSecretsRepository();
  const secretsService = new SecretsService(secretsRepo, projectsRepo);
  const secretsController = new SecretsController(secretsService, projectsService);
  const secretsRoutes = initSecretsRoutes(secretsController);

  const apiKeysRepo = new MongooseApiKeysRepository();
  const apiKeysService = new ApiKeysService(apiKeysRepo, projectsRepo, orgRepo);
  const apiKeysController = new ApiKeysController(apiKeysService);
  const apiKeysRoutes = initApiKeysRoutes(apiKeysController);

  // Mount API Features
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/organizations', orgRoutes);
  app.use('/api/v1', projectsRoutes);
  app.use('/api/v1', secretsRoutes);
  app.use('/api/v1', apiKeysRoutes);


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
