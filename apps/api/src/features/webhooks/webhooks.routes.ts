import { Router } from 'express';
import type { WebhooksController } from './webhooks.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initWebhooksRoutes(webhooksController: WebhooksController): Router {
  const router = Router();

  // Webhooks management scoped under organizations
  router.post(
    '/organizations/:orgId/webhooks',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    webhooksController.createWebhook
  );

  router.get(
    '/organizations/:orgId/webhooks',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'member' }),
    webhooksController.listWebhooks
  );

  router.get(
    '/organizations/:orgId/webhooks/:webhookId',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'member' }),
    webhooksController.getWebhook
  );

  router.patch(
    '/organizations/:orgId/webhooks/:webhookId',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    webhooksController.updateWebhook
  );

  router.delete(
    '/organizations/:orgId/webhooks/:webhookId',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    webhooksController.deleteWebhook
  );

  router.post(
    '/organizations/:orgId/webhooks/:webhookId/rotate-secret',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    webhooksController.rotateSecret
  );

  router.post(
    '/organizations/:orgId/webhooks/:webhookId/test',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    webhooksController.testWebhook
  );

  // Delivery log history
  router.get(
    '/organizations/:orgId/webhooks/:webhookId/deliveries',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'member' }),
    webhooksController.listDeliveries
  );

  router.get(
    '/organizations/:orgId/webhooks/:webhookId/deliveries/:deliveryId',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'member' }),
    webhooksController.getDelivery
  );

  return router;
}
