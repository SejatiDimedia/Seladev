import { Router } from 'express';
import type { AuditLogsController } from './audit-logs.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initAuditLogsRoutes(auditLogsController: AuditLogsController): Router {
  const router = Router();

  router.get(
    '/organizations/:orgIdOrSlug/audit-logs',
    authenticateJwt,
    authorizeRbac({ requiredOrgRole: 'admin' }),
    auditLogsController.listHistory
  );

  return router;
}
