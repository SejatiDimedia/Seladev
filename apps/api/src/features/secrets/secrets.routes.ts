import { Router } from 'express';
import type { SecretsController } from './secrets.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initSecretsRoutes(secretsController: SecretsController): Router {
  const router = Router();

  // Secrets operations scoped under projects/environments
  router.post(
    '/projects/:projectId/environments/:envId/secrets',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.createSecret
  );

  router.get(
    '/projects/:projectId/environments/:envId/secrets',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.listSecrets
  );

  // Single secret operations
  router.get(
    '/projects/:projectId/secrets/:secretId',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.getSecretMetadata
  );

  router.post(
    '/projects/:projectId/secrets/:secretId/reveal',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.revealSecret
  );

  router.patch(
    '/projects/:projectId/secrets/:secretId',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.updateSecret
  );

  router.delete(
    '/projects/:projectId/secrets/:secretId',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.deleteSecret
  );

  // Versioning and Rollback (Phase 2.3)
  router.get(
    '/projects/:projectId/secrets/:secretId/versions',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.listSecretVersions
  );

  router.post(
    '/projects/:projectId/secrets/:secretId/rollback',
    authenticateJwt,
    authorizeRbac({ requiredProjectRole: 'developer' }),
    secretsController.rollbackSecret
  );

  return router;
}
