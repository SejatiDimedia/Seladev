import { Router } from 'express';
import type { ApiKeysController } from './api-keys.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initApiKeysRoutes(apiKeysController: ApiKeysController): Router {
  const router = Router();

  // Org-scoped operations
  router.post(
    '/organizations/:orgIdOrSlug/api-keys',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    apiKeysController.createKey
  );

  router.get(
    '/organizations/:orgIdOrSlug/api-keys',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    apiKeysController.listKeys
  );

  // Single key operations (Org admin validation checked inside the service)
  router.get(
    '/api-keys/:keyId',
    authenticateJwt,
    apiKeysController.getKeyMetadata
  );

  router.patch(
    '/api-keys/:keyId',
    authenticateJwt,
    apiKeysController.updateKey
  );

  router.delete(
    '/api-keys/:keyId',
    authenticateJwt,
    apiKeysController.deleteKey
  );

  return router;
}
