import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { ProjectsService } from './projects.service';
import { ForbiddenError } from '../../lib/errors';
import { 
  createProjectSchema, 
  updateProjectSchema, 
  createEnvironmentSchema, 
  updateEnvironmentSchema, 
  updateEnvironmentVariablesSchema,
  assignProjectMemberSchema, 
  updateProjectMemberRoleSchema 
} from './projects.schema';


export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  private getClientContext(req: Request) {
    return {
      ipAddress: req.ip || null,
      userAgent: (req.headers['user-agent'] as string) || null,
    };
  }

  createProject = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const orgIdOrSlug = req.params.orgIdOrSlug!;
    const dto = createProjectSchema.parse(req.body);
    const userId = (req as any).user.id;

    const project = await this.projectsService.createProject(userId, orgIdOrSlug, dto, this.getClientContext(req));

    res.status(201).json({
      success: true,
      data: project,
    });
  });

  getProject = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const project = await this.projectsService.getProject(projectId);

    res.status(200).json({
      success: true,
      data: project,
    });
  });

  listProjects = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const orgIdOrSlug = req.params.orgIdOrSlug!;
    const projects = await this.projectsService.listProjects(orgIdOrSlug);

    res.status(200).json({
      success: true,
      data: projects,
    });
  });

  updateProject = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const dto = updateProjectSchema.parse(req.body);
    const userId = (req as any).user.id;
    const project = await this.projectsService.updateProject(projectId, dto, userId, this.getClientContext(req));

    res.status(200).json({
      success: true,
      data: project,
    });
  });

  archiveProject = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const userId = (req as any).user.id;
    await this.projectsService.archiveProject(projectId, userId, this.getClientContext(req));

    res.status(204).end();
  });

  // Environments
  listEnvironments = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const environments = await this.projectsService.listEnvironments(projectId);

    res.status(200).json({
      success: true,
      data: environments,
    });
  });

  createEnvironment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const dto = createEnvironmentSchema.parse(req.body);
    const environment = await this.projectsService.createEnvironment(projectId, dto);

    res.status(201).json({
      success: true,
      data: environment,
    });
  });

  updateEnvironment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const id = req.params.id!;

    if (req.body.variables !== undefined) {
      const { variables } = updateEnvironmentVariablesSchema.parse(req.body);
      const user = (req as any).user;
      const projectMember = await this.projectsService.findProjectMember(projectId, user.id);
      const userWithProjRole = {
        ...user,
        projectRole: projectMember ? projectMember.role : undefined
      };
      const environment = await this.projectsService.updateEnvironmentVariables(projectId, id, variables, userWithProjRole);
      res.status(200).json({
        success: true,
        data: environment,
      });
      return;
    }

    // Updating environment name/description requires project admin
    const user = (req as any).user;
    const projectMember = await this.projectsService.findProjectMember(projectId, user.id);
    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    const isProjAdmin = projectMember?.role === 'admin';
    if (!isOrgAdmin && !isProjAdmin) {
      throw new ForbiddenError('Only project admins can update environment settings');
    }

    const dto = updateEnvironmentSchema.parse(req.body);
    const environment = await this.projectsService.updateEnvironment(projectId, id, dto);

    res.status(200).json({
      success: true,
      data: environment,
    });
  });

  deleteEnvironment = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const id = req.params.id!;
    await this.projectsService.deleteEnvironment(projectId, id);

    res.status(204).end();
  });

  updateEnvironmentVariables = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const id = req.params.id!;
    const { variables } = updateEnvironmentVariablesSchema.parse(req.body);
    const user = (req as any).user;
    const projectMember = await this.projectsService.findProjectMember(projectId, user.id);
    const userWithProjRole = {
      ...user,
      projectRole: projectMember ? projectMember.role : undefined
    };
    const environment = await this.projectsService.updateEnvironmentVariables(projectId, id, variables, userWithProjRole);

    res.status(200).json({
      success: true,
      data: environment,
    });
  });

  // Members
  listMembers = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const members = await this.projectsService.listMembers(projectId);

    res.status(200).json({
      success: true,
      data: members,
    });
  });

  addMember = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const dto = assignProjectMemberSchema.parse(req.body);
    const assignedBy = (req as any).user.id;
    const member = await this.projectsService.addMember(projectId, assignedBy, dto, this.getClientContext(req));

    res.status(201).json({
      success: true,
      data: member,
    });
  });

  updateMemberRole = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const userId = req.params.userId!;
    const dto = updateProjectMemberRoleSchema.parse(req.body);
    const member = await this.projectsService.updateMemberRole(projectId, userId, dto);

    res.status(200).json({
      success: true,
      data: member,
    });
  });

  removeMember = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.projectId!;
    const userId = req.params.userId!;
    const removedBy = (req as any).user.id;
    await this.projectsService.removeMember(projectId, userId, removedBy, this.getClientContext(req));

    res.status(204).end();
  });
}
