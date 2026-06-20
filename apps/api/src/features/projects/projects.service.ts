import type { ProjectsRepository } from './projects.repository';
import type { OrganizationsRepository } from '../organizations/organizations.repository';
import { 
  ConflictError, 
  NotFoundError, 
  ValidationError, 
  ForbiddenError 
} from '../../lib/errors';
import { slugify } from '@seladev/utils';
import type {
  Project,
  ProjectMember,
  Environment,
  EnvironmentVariable,
  CreateProjectDto,
  UpdateProjectDto,
  CreateEnvironmentDto,
  UpdateEnvironmentDto,
  AssignProjectMemberDto,
  UpdateProjectMemberRoleDto
} from './projects.types';

export class ProjectsService {
  constructor(
    private readonly projectsRepo: ProjectsRepository,
    private readonly orgRepo: OrganizationsRepository
  ) {}

  async createProject(
    userId: string,
    orgIdOrSlug: string,
    dto: CreateProjectDto
  ): Promise<Project> {
    // 1. Resolve organization by ID or Slug
    let org = await this.orgRepo.findOrgById(orgIdOrSlug);
    if (!org) {
      org = await this.orgRepo.findOrgBySlug(orgIdOrSlug);
    }
    if (!org) {
      throw new NotFoundError('Organization', orgIdOrSlug);
    }

    // 2. Validate Project Limit
    const activeProjects = await this.projectsRepo.listProjectsByOrg(org.id);
    const maxProjects = org.settings?.maxProjects ?? 3;
    if (activeProjects.length >= maxProjects) {
      throw new ValidationError([], `Project limit reached for this organization (Max: ${maxProjects})`);
    }

    // 3. Generate and validate slug uniqueness within organization
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
    const existingProject = await this.projectsRepo.findProjectBySlug(org.id, slug);
    if (existingProject) {
      throw new ConflictError(`Project with slug "${slug}" already exists in this organization`);
    }

    // 4. Create Project
    const projectDoc = await this.projectsRepo.createProject({
      organizationId: org.id,
      name: dto.name,
      slug,
      description: dto.description,
      visibility: dto.visibility,
      repositoryUrl: dto.repositoryUrl ?? null,
      tags: dto.tags,
      createdBy: userId,
    });

    // 5. Provision Default Environments (development, staging, production)
    await this.projectsRepo.createEnvironment({
      organizationId: org.id,
      projectId: projectDoc.id,
      name: 'development',
      slug: 'development',
      type: 'development',
      isProtected: false,
      description: 'Development environment',
    });

    await this.projectsRepo.createEnvironment({
      organizationId: org.id,
      projectId: projectDoc.id,
      name: 'staging',
      slug: 'staging',
      type: 'staging',
      isProtected: false,
      description: 'Staging environment',
    });

    await this.projectsRepo.createEnvironment({
      organizationId: org.id,
      projectId: projectDoc.id,
      name: 'production',
      slug: 'production',
      type: 'production',
      isProtected: true,
      description: 'Production environment',
    });

    // 6. Assign Creator as Project Admin
    await this.projectsRepo.addProjectMember({
      projectId: projectDoc.id,
      userId,
      role: 'admin',
      assignedBy: userId,
    });

    return projectDoc.toJSON() as unknown as Project;
  }

  async getProject(projectId: string): Promise<Project> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }
    return projectDoc.toJSON() as unknown as Project;
  }

  async listProjects(orgIdOrSlug: string): Promise<Project[]> {
    let org = await this.orgRepo.findOrgById(orgIdOrSlug);
    if (!org) {
      org = await this.orgRepo.findOrgBySlug(orgIdOrSlug);
    }
    if (!org) {
      throw new NotFoundError('Organization', orgIdOrSlug);
    }

    const projects = await this.projectsRepo.listProjectsByOrg(org.id);
    return projects.map(p => p.toJSON() as unknown as Project);
  }

  async updateProject(projectId: string, dto: UpdateProjectDto): Promise<Project> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }

    // Name, description, visibility, repositoryUrl, tags, settings are updatable.
    // slug is immutable.
    if (dto.name !== undefined) projectDoc.name = dto.name;
    if (dto.description !== undefined) projectDoc.description = dto.description;
    if (dto.visibility !== undefined) projectDoc.visibility = dto.visibility;
    if (dto.repositoryUrl !== undefined) projectDoc.repositoryUrl = dto.repositoryUrl;
    if (dto.tags !== undefined) projectDoc.tags = dto.tags;
    
    if (dto.settings !== undefined) {
      if (dto.settings.deploymentProtection !== undefined) {
        projectDoc.settings.deploymentProtection = dto.settings.deploymentProtection;
      }
      if (dto.settings.requireApproval !== undefined) {
        projectDoc.settings.requireApproval = dto.settings.requireApproval;
      }
      if (dto.settings.allowedBranches !== undefined) {
        projectDoc.settings.allowedBranches = dto.settings.allowedBranches;
      }
    }

    await projectDoc.save();
    return projectDoc.toJSON() as unknown as Project;
  }

  async archiveProject(projectId: string): Promise<void> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }

    projectDoc.archivedAt = new Date();
    await projectDoc.save();
  }

  // Environments API
  async listEnvironments(projectId: string): Promise<Environment[]> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }

    const environments = await this.projectsRepo.listEnvironmentsByProject(projectId);
    return environments.map(e => e.toJSON() as unknown as Environment);
  }

  async createEnvironment(projectId: string, dto: CreateEnvironmentDto): Promise<Environment> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }

    const slug = slugify(dto.name);
    const existingEnv = await this.projectsRepo.findEnvironmentBySlug(projectId, slug);
    if (existingEnv) {
      throw new ConflictError(`Environment with slug "${slug}" already exists in this project`);
    }

    // Determine type from name mapping
    let type: 'development' | 'staging' | 'production' = 'development';
    const nameLower = dto.name.toLowerCase();
    if (nameLower.includes('production') || nameLower.includes('prod')) {
      type = 'production';
    } else if (nameLower.includes('staging') || nameLower.includes('stage')) {
      type = 'staging';
    }

    const isProtected = type === 'production';

    const envDoc = await this.projectsRepo.createEnvironment({
      organizationId: projectDoc.organizationId.toString(),
      projectId,
      name: dto.name,
      slug,
      type,
      isProtected,
      description: dto.description || '',
      variables: [],
    });

    return envDoc.toJSON() as unknown as Environment;
  }

  async updateEnvironment(projectId: string, envId: string, dto: UpdateEnvironmentDto): Promise<Environment> {
    const envDoc = await this.projectsRepo.findEnvironmentById(envId);
    if (!envDoc || envDoc.projectId.toString() !== projectId) {
      throw new NotFoundError('Environment', envId);
    }

    if (dto.name !== undefined) {
      const slug = slugify(dto.name);
      if (slug !== envDoc.slug) {
        const existingEnv = await this.projectsRepo.findEnvironmentBySlug(projectId, slug);
        if (existingEnv) {
          throw new ConflictError(`Environment with slug "${slug}" already exists in this project`);
        }
        envDoc.name = dto.name;
        envDoc.slug = slug;
      }
    }
    if (dto.description !== undefined) {
      envDoc.description = dto.description;
    }

    await envDoc.save();
    return envDoc.toJSON() as unknown as Environment;
  }

  async deleteEnvironment(projectId: string, envId: string): Promise<void> {
    const envDoc = await this.projectsRepo.findEnvironmentById(envId);
    if (!envDoc || envDoc.projectId.toString() !== projectId) {
      throw new NotFoundError('Environment', envId);
    }

    if (envDoc.isProtected || envDoc.type === 'production') {
      throw new ValidationError([], 'Protected or production environments cannot be deleted');
    }

    await this.projectsRepo.deleteEnvironment(envId);
  }

  async findProjectMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    const doc = await this.projectsRepo.findProjectMember(projectId, userId);
    return doc ? (doc.toJSON() as unknown as ProjectMember) : null;
  }

  async updateEnvironmentVariables(
    projectId: string,
    envId: string,
    variables: EnvironmentVariable[],
    user?: { id: string; role: string; projectRole?: string }
  ): Promise<Environment> {
    const envDoc = await this.projectsRepo.findEnvironmentById(envId);
    if (!envDoc || envDoc.projectId.toString() !== projectId) {
      throw new NotFoundError('Environment', envId);
    }

    // Enforce environment protection controls
    if (envDoc.isProtected && user) {
      const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
      const isProjAdmin = user.projectRole === 'admin';
      if (!isOrgAdmin && !isProjAdmin) {
        throw new ForbiddenError('Only project admins can update variables in protected environments');
      }
    }

    // Validate duplicate keys
    const keys = new Set<string>();
    for (const variable of variables) {
      if (keys.has(variable.key)) {
        throw new ValidationError([], `Duplicate variable key: "${variable.key}"`);
      }
      keys.add(variable.key);
    }

    // Set variables
    envDoc.variables = variables;
    await envDoc.save();

    return envDoc.toJSON() as unknown as Environment;
  }


  // Project Members API
  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }

    const members = await this.projectsRepo.listProjectMembers(projectId);
    return members.map(m => m.toJSON() as unknown as ProjectMember);
  }

  async addMember(
    projectId: string,
    assignedBy: string,
    dto: AssignProjectMemberDto
  ): Promise<ProjectMember> {
    const projectDoc = await this.projectsRepo.findProjectById(projectId);
    if (!projectDoc) {
      throw new NotFoundError('Project', projectId);
    }

    // 1. Verify user is active in organization
    const orgMembership = await this.orgRepo.findMembership(projectDoc.organizationId.toString(), dto.userId);
    if (!orgMembership || orgMembership.status !== 'active') {
      throw new ValidationError([], 'User must be an active member of the parent organization');
    }

    // 2. Verify user not already in project
    const existingMember = await this.projectsRepo.findProjectMember(projectId, dto.userId);
    if (existingMember) {
      throw new ConflictError('User is already a member of this project');
    }

    // 3. Add user
    const memberDoc = await this.projectsRepo.addProjectMember({
      projectId,
      userId: dto.userId,
      role: dto.role,
      assignedBy,
    });

    return memberDoc.toJSON() as unknown as ProjectMember;
  }

  async updateMemberRole(
    projectId: string,
    userId: string,
    dto: UpdateProjectMemberRoleDto
  ): Promise<ProjectMember> {
    const memberDoc = await this.projectsRepo.findProjectMember(projectId, userId);
    if (!memberDoc) {
      throw new NotFoundError('Project Membership', `${projectId}/${userId}`);
    }

    if (memberDoc.role === 'admin' && dto.role !== 'admin') {
      // Check sole admin
      const members = await this.projectsRepo.listProjectMembers(projectId);
      const admins = members.filter(m => m.role === 'admin');
      if (admins.length <= 1) {
        throw new ValidationError([], 'Cannot change the role of the sole project admin');
      }
    }

    memberDoc.role = dto.role;
    await memberDoc.save();

    return memberDoc.toJSON() as unknown as ProjectMember;
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    const memberDoc = await this.projectsRepo.findProjectMember(projectId, userId);
    if (!memberDoc) {
      throw new NotFoundError('Project Membership', `${projectId}/${userId}`);
    }

    if (memberDoc.role === 'admin') {
      // Check sole admin
      const members = await this.projectsRepo.listProjectMembers(projectId);
      const admins = members.filter(m => m.role === 'admin');
      if (admins.length <= 1) {
        throw new ValidationError([], 'Cannot remove the sole project admin');
      }
    }

    await this.projectsRepo.removeProjectMember(memberDoc.id);
  }
}
