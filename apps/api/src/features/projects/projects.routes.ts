import { Router } from 'express';
import type { ProjectsController } from './projects.controller';
import { authenticateJwt } from '../../middleware/authenticate-jwt';
import { authorizeRbac } from '../../middleware/authorize-rbac';

export function initProjectsRoutes(projectsController: ProjectsController): Router {
  const router = Router();

  // Project-level routes under organization
  router.post('/organizations/:orgIdOrSlug/projects', authenticateJwt, authorizeRbac({ requiredOrgRole: 'admin' }), projectsController.createProject);
  router.get('/organizations/:orgIdOrSlug/projects', authenticateJwt, authorizeRbac({ requiredOrgRole: 'viewer' }), projectsController.listProjects);

  // Project CRUD by projectId
  router.get('/projects/:projectId', authenticateJwt, authorizeRbac({ requiredProjectRole: 'viewer' }), projectsController.getProject);
  router.patch('/projects/:projectId', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.updateProject);
  router.delete('/projects/:projectId', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.archiveProject);

  // Environments
  router.get('/projects/:projectId/environments', authenticateJwt, authorizeRbac({ requiredProjectRole: 'viewer' }), projectsController.listEnvironments);
  router.post('/projects/:projectId/environments', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.createEnvironment);
  router.patch('/projects/:projectId/environments/:id', authenticateJwt, authorizeRbac({ requiredProjectRole: 'developer' }), projectsController.updateEnvironment);
  router.delete('/projects/:projectId/environments/:id', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.deleteEnvironment);
  router.put('/projects/:projectId/environments/:id/variables', authenticateJwt, authorizeRbac({ requiredProjectRole: 'developer' }), projectsController.updateEnvironmentVariables);

  // Project Members
  router.get('/projects/:projectId/members', authenticateJwt, authorizeRbac({ requiredProjectRole: 'viewer' }), projectsController.listMembers);
  router.post('/projects/:projectId/members', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.addMember);
  router.patch('/projects/:projectId/members/:userId', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.updateMemberRole);
  router.delete('/projects/:projectId/members/:userId', authenticateJwt, authorizeRbac({ requiredProjectRole: 'admin' }), projectsController.removeMember);

  return router;
}
