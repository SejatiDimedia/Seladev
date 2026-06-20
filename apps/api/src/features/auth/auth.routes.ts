import { Router } from 'express';
import type { AuthController } from './auth.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';

export function initAuthRoutes(authController: AuthController): Router {
  const router = Router();

  router.post('/register', authController.register);
  router.post('/login', authController.login);
  router.post('/login/mfa', authController.verifyLoginMfa);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);
  router.put('/password', authenticateJwt, authController.changePassword);

  // MFA Management (Requires standard auth)
  router.post('/mfa/setup', authenticateJwt, authController.setupMfa);
  router.post('/mfa/activate', authenticateJwt, authController.activateMfa);
  router.post('/mfa/disable', authenticateJwt, authController.disableMfa);

  return router;
}
