import { Router } from 'express';
import { NotificationsController } from './notifications.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { validateRequest } from '../../middleware/validate-request';
import { updatePreferencesSchema } from '@seladev/validators';

export function initNotificationsRoutes(controller: NotificationsController): Router {
  const router = Router();

  // All routes are protected by JWT authentication
  router.use(authenticateJwt);

  router.get('/', controller.getUserNotifications);
  router.put('/read-all', controller.markAllAsRead);
  router.put('/:notificationId/read', controller.markAsRead);

  return router;
}

export function initNotificationPreferencesRoutes(controller: NotificationsController): Router {
  const router = Router();

  router.use(authenticateJwt);

  router.get('/', controller.getPreferences);
  router.put('/', validateRequest({ body: updatePreferencesSchema }), controller.updatePreferences);

  return router;
}
