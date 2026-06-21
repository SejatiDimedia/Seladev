import { Router } from 'express';
import type { OrganizationsController } from './organizations.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initOrganizationsRoutes(orgController: OrganizationsController): Router {
  const router = Router();

  router.post('/', authenticateJwt, orgController.createOrg);
  router.get('/', authenticateJwt, orgController.getUserOrgs);
  router.get('/:orgId', authenticateJwt, orgController.getOrg);
  router.get('/:orgId/members', authenticateJwt, orgController.getMembers);
  router.post('/:orgId/members', authenticateJwt, authorizeRbac({ requiredOrgRole: 'admin' }), orgController.inviteMember);
  router.put('/:orgId/members/:userId', authenticateJwt, authorizeRbac({ requiredOrgRole: 'admin' }), orgController.updateMemberRole);
  router.delete('/:orgId/members/:userId', authenticateJwt, authorizeRbac({ requiredOrgRole: 'admin' }), orgController.removeMember);

  return router;
}
