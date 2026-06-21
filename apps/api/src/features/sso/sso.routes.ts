import { Router } from 'express';
import type { SsoController } from './sso.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initSsoRoutes(ssoController: SsoController): Router {
  const router = Router();

  // Public SSO Login endpoints
  router.get('/auth/sso/discover', ssoController.discoverSso);
  router.post('/auth/sso/discover', ssoController.discoverSso);
  router.get('/auth/sso/login/saml/:orgId', ssoController.initiateSamlLogin);
  router.post('/auth/sso/callback/saml/:orgId', ssoController.handleSamlCallback);
  router.get('/auth/sso/login/oidc/:orgId', ssoController.initiateOidcLogin);
  router.get('/auth/sso/callback/oidc', ssoController.handleOidcCallback);
  router.get('/auth/sso/metadata/:orgId', ssoController.getSamlSpMetadata);

  // Admin SSO Configurations CRUD
  router.post(
    '/organizations/:orgId/sso-config',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    ssoController.createSsoConfig
  );

  router.get(
    '/organizations/:orgId/sso-config',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    ssoController.getSsoConfig
  );

  router.patch(
    '/organizations/:orgId/sso-config',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    ssoController.updateSsoConfig
  );

  router.delete(
    '/organizations/:orgId/sso-config',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'owner' }),
    ssoController.deleteSsoConfig
  );

  return router;
}
