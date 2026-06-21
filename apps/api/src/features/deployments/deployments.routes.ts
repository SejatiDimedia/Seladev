import { Router } from 'express';
import type { DeploymentsController } from './deployments.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initDeploymentsRoutes(deploymentsController: DeploymentsController): Router {
  const router = Router();

  router.post(
    '/projects/:projectId/deployments',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    deploymentsController.triggerDeployment
  );

  router.get(
    '/projects/:projectId/deployments',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'viewer' }),
    deploymentsController.listHistory
  );

  router.get(
    '/projects/:projectId/deployments/:deploymentId',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'viewer' }),
    deploymentsController.getDeployment
  );

  router.post(
    '/projects/:projectId/deployments/:deploymentId/cancel',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    deploymentsController.cancelDeployment
  );

  router.post(
    '/projects/:projectId/deployments/:deploymentId/approve',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    deploymentsController.approveDeployment
  );

  router.post(
    '/projects/:projectId/deployments/:deploymentId/reject',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'admin' }),
    deploymentsController.rejectDeployment
  );

  router.post(
    '/projects/:projectId/deployments/:deploymentId/promote',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    deploymentsController.promoteDeployment
  );

  return router;
}
