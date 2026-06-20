import { Router } from 'express';
import type { AuthController } from './auth.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';

export function initAuthRoutes(authController: AuthController): Router {
  const router = Router();

  router.post('/register', authController.register);
  router.post('/login', authController.login);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);
  router.put('/password', authenticateJwt, authController.changePassword);

  return router;
}
