import { Router } from 'express';
import type { AnalyticsController } from './analytics.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initAnalyticsRoutes(analyticsController: AnalyticsController): Router {
  const router = Router();

  router.get(
    '/projects/:projectId/analytics/deployments',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    analyticsController.getDeployments
  );

  router.get(
    '/projects/:projectId/analytics/api-keys',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    analyticsController.getApiKeys
  );

  router.get(
    '/projects/:projectId/analytics/secrets',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    analyticsController.getSecrets
  );

  router.get(
    '/projects/:projectId/analytics/webhooks',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    analyticsController.getWebhooks
  );

  return router;
}
