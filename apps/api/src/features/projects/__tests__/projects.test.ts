import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectsService } from '../projects.service';
import type { ProjectsRepository } from '../projects.repository';
import type { OrganizationsRepository } from '../../organizations/organizations.repository';
import { ConflictError, ValidationError, ForbiddenError } from '../../../lib/errors';
import type { ProjectRole } from '../projects.types';

// Helpers to mock Mongoose-like documents
function createMockProjectDoc(data: any) {
  const doc = {
    id: data.id || 'project-123',
    _id: data.id || 'project-123',
    organizationId: data.organizationId,
    name: data.name,
    slug: data.slug,
    description: data.description || '',
    visibility: data.visibility || 'private',
    repositoryUrl: data.repositoryUrl || null,
    tags: data.tags || [],
    settings: data.settings || {
      deploymentProtection: false,
      requireApproval: false,
      allowedBranches: [],
    },
    createdBy: data.createdBy,
    archivedAt: data.archivedAt || null,
    save: async function() { return this; },
    toJSON: function() {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        name: this.name,
        slug: this.slug,
        description: this.description,
        visibility: this.visibility,
        repositoryUrl: this.repositoryUrl,
        tags: this.tags,
        settings: this.settings,
        createdBy: this.createdBy.toString(),
        archivedAt: this.archivedAt ? this.archivedAt.toISOString() : null,
      };
    }
  };
  return doc as any;
}

function createMockEnvDoc(data: any) {
  const doc = {
    id: data.id || 'env-123',
    _id: data.id || 'env-123',
    organizationId: data.organizationId,
    projectId: data.projectId,
    name: data.name,
    slug: data.slug,
    type: data.type,
    isProtected: data.isProtected || false,
    variables: data.variables || [],
    description: data.description || '',
    save: async function() { return this; },
    toJSON: function() {
      return {
        id: this.id,
        organizationId: this.organizationId.toString(),
        projectId: this.projectId.toString(),
        name: this.name,
        slug: this.slug,
        type: this.type,
        isProtected: this.isProtected,
        variables: this.variables,
        description: this.description,
      };
    }
  };
  return doc as any;
}

function createMockProjectMemberDoc(data: any) {
  const doc = {
    id: data.id || 'pm-123',
    _id: data.id || 'pm-123',
    projectId: data.projectId,
    userId: data.userId,
    role: data.role,
    assignedBy: data.assignedBy,
    save: async function() { return this; },
    toJSON: function() {
      return {
        id: this.id,
        projectId: this.projectId.toString(),
        userId: this.userId.toString(),
        role: this.role,
        assignedBy: this.assignedBy.toString(),
      };
    }
  };
  return doc as any;
}

class InMemoryProjectsRepository implements ProjectsRepository {
  public projects: any[] = [];
  public environments: any[] = [];
  public members: any[] = [];

  async findProjectById(id: string): Promise<any | null> {
    const project = this.projects.find(p => p.id === id);
    return project || null;
  }

  async findProjectBySlug(orgId: string, slug: string): Promise<any | null> {
    const project = this.projects.find(p => p.organizationId === orgId && p.slug === slug.toLowerCase());
    return project || null;
  }

  async createProject(data: any): Promise<any> {
    const project = createMockProjectDoc({
      ...data,
      id: `project-${this.projects.length + 1}`,
    });
    this.projects.push(project);
    return project;
  }

  async updateProject(id: string, update: Partial<any>): Promise<any | null> {
    const project = await this.findProjectById(id);
    if (!project) return null;
    Object.assign(project, update);
    return project;
  }

  async listProjectsByOrg(orgId: string): Promise<any[]> {
    return this.projects.filter(p => p.organizationId === orgId && p.archivedAt === null);
  }

  async createEnvironment(data: any): Promise<any> {
    const env = createMockEnvDoc({
      ...data,
      id: `env-${this.environments.length + 1}`,
    });
    this.environments.push(env);
    return env;
  }

  async findEnvironmentById(id: string): Promise<any | null> {
    const env = this.environments.find(e => e.id === id);
    return env || null;
  }

  async findEnvironmentBySlug(projectId: string, slug: string): Promise<any | null> {
    const env = this.environments.find(e => e.projectId === projectId && e.slug === slug.toLowerCase());
    return env || null;
  }

  async listEnvironmentsByProject(projectId: string): Promise<any[]> {
    return this.environments.filter(e => e.projectId === projectId);
  }

  async updateEnvironment(id: string, update: Partial<any>): Promise<any | null> {
    const env = await this.findEnvironmentById(id);
    if (!env) return null;
    Object.assign(env, update);
    return env;
  }

  async deleteEnvironment(id: string): Promise<boolean> {
    const initialLen = this.environments.length;
    this.environments = this.environments.filter(e => e.id !== id);
    return this.environments.length < initialLen;
  }

  async addProjectMember(data: any): Promise<any> {
    const member = createMockProjectMemberDoc({
      ...data,
      id: `pm-${this.members.length + 1}`,
    });
    this.members.push(member);
    return member;
  }

  async findProjectMember(projectId: string, userId: string): Promise<any | null> {
    const member = this.members.find(m => m.projectId === projectId && m.userId === userId);
    return member || null;
  }

  async findProjectMemberById(id: string): Promise<any | null> {
    const member = this.members.find(m => m.id === id);
    return member || null;
  }

  async listProjectMembers(projectId: string): Promise<any[]> {
    return this.members.filter(m => m.projectId === projectId);
  }

  async updateProjectMemberRole(id: string, role: ProjectRole): Promise<any | null> {
    const member = await this.findProjectMemberById(id);
    if (!member) return null;
    member.role = role;
    return member;
  }

  async removeProjectMember(id: string): Promise<boolean> {
    const initialLen = this.members.length;
    this.members = this.members.filter(m => m.id !== id);
    return this.members.length < initialLen;
  }

  async countProjectMembers(projectId: string): Promise<number> {
    return this.members.filter(m => m.projectId === projectId).length;
  }
}

class InMemoryOrganizationsRepository implements OrganizationsRepository {
  public orgs: any[] = [];
  public memberships: any[] = [];

  async findOrgById(id: string): Promise<any | null> {
    const org = this.orgs.find(o => o.id === id);
    return org || null;
  }

  async findOrgBySlug(slug: string): Promise<any | null> {
    const org = this.orgs.find(o => o.slug === slug.toLowerCase());
    return org || null;
  }

  async createOrg(data: any): Promise<any> {
    const org = {
      id: data.id || `org-${this.orgs.length + 1}`,
      name: data.name,
      slug: data.slug.toLowerCase(),
      settings: data.settings || { maxProjects: 3 },
      toJSON: function() { return this; }
    };
    this.orgs.push(org);
    return org;
  }

  async createMembership(data: any): Promise<any> {
    const mem = {
      id: `mem-${this.memberships.length + 1}`,
      organizationId: data.organizationId,
      userId: data.userId,
      role: data.role,
      invitedBy: data.invitedBy,
      status: data.status,
      toJSON: function() { return this; }
    };
    this.memberships.push(mem);
    return mem;
  }

  async findMembership(orgId: string, userId: string): Promise<any | null> {
    const mem = this.memberships.find(m => m.organizationId === orgId && m.userId === userId);
    return mem || null;
  }

  async findMembershipsByOrg(orgId: string): Promise<any[]> {
    return this.memberships.filter(m => m.organizationId === orgId);
  }

  async updateMembership(_id: string, _update: Partial<any>): Promise<any | null> {
    return null;
  }

  async deleteMembership(_id: string): Promise<boolean> {
    return false;
  }

  async countOrgMembers(_orgId: string): Promise<number> {
    return 0;
  }

  async findUserByEmail(_email: string): Promise<any | null> {
    return null;
  }
}

describe('Projects and Environments Module Tests', () => {
  let projectsRepo: InMemoryProjectsRepository;
  let orgRepo: InMemoryOrganizationsRepository;
  let projectsService: ProjectsService;

  const mockUserId = 'user-123';
  let mockOrg: any;

  beforeEach(async () => {
    projectsRepo = new InMemoryProjectsRepository();
    orgRepo = new InMemoryOrganizationsRepository();
    projectsService = new ProjectsService(projectsRepo, orgRepo);

    mockOrg = await orgRepo.createOrg({
      id: 'org-999',
      name: 'Acme Corp',
      slug: 'acme-corp',
      settings: { maxProjects: 3 },
    });

    await orgRepo.createMembership({
      organizationId: mockOrg.id,
      userId: mockUserId,
      role: 'admin',
      status: 'active',
      invitedBy: mockUserId,
    });
  });

  describe('Project Creation', () => {
    it('should successfully create a project with default environments and assigned creator', async () => {
      const dto = {
        name: 'Payment Gateway',
        description: 'Core gateway payment processing',
        visibility: 'private' as const,
        tags: ['billing'],
      };

      const project = await projectsService.createProject(mockUserId, 'acme-corp', dto);

      expect(project.name).toBe('Payment Gateway');
      expect(project.slug).toBe('payment-gateway');
      expect(project.organizationId).toBe(mockOrg.id);

      // Verify defaults
      const member = await projectsRepo.findProjectMember(project.id, mockUserId);
      expect(member).not.toBeNull();
      expect(member.role).toBe('admin');

      const environments = await projectsRepo.listEnvironmentsByProject(project.id);
      expect(environments).toHaveLength(3);
      const dev = environments.find(e => e.slug === 'development');
      const staging = environments.find(e => e.slug === 'staging');
      const prod = environments.find(e => e.slug === 'production');

      expect(dev).toBeDefined();
      expect(dev.type).toBe('development');
      expect(dev.isProtected).toBe(false);

      expect(staging).toBeDefined();
      expect(staging.type).toBe('staging');
      expect(staging.isProtected).toBe(false);

      expect(prod).toBeDefined();
      expect(prod.type).toBe('production');
      expect(prod.isProtected).toBe(true);
    });

    it('should reject creation if project slug already exists within organization', async () => {
      const dto = {
        name: 'Payment API',
        description: '',
        visibility: 'private' as const,
        tags: [],
      };
      await projectsService.createProject(mockUserId, 'acme-corp', dto);

      await expect(
        projectsService.createProject(mockUserId, 'acme-corp', dto)
      ).rejects.toThrow(ConflictError);
    });

    it('should reject creation if organization project limit is exceeded', async () => {
      await projectsService.createProject(mockUserId, 'acme-corp', { name: 'Proj 1', description: '', visibility: 'private', tags: [] });
      await projectsService.createProject(mockUserId, 'acme-corp', { name: 'Proj 2', description: '', visibility: 'private', tags: [] });
      await projectsService.createProject(mockUserId, 'acme-corp', { name: 'Proj 3', description: '', visibility: 'private', tags: [] });

      await expect(
        projectsService.createProject(mockUserId, 'acme-corp', { name: 'Proj 4', description: '', visibility: 'private', tags: [] })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Environments Operations', () => {
    let project: any;

    beforeEach(async () => {
      project = await projectsService.createProject(mockUserId, 'acme-corp', { name: 'Core API', description: '', visibility: 'private', tags: [] });
    });

    it('should create custom environment with correct mappings', async () => {
      const env = await projectsService.createEnvironment(project.id, {
        name: 'Internal Testing Staging',
        description: 'Internal testing env',
      });

      expect(env.slug).toBe('internal-testing-staging');
      expect(env.type).toBe('staging');
      expect(env.isProtected).toBe(false);
    });

    it('should update environment variables', async () => {
      const devEnv = projectsRepo.environments.find(e => e.projectId === project.id && e.slug === 'development');
      expect(devEnv).toBeDefined();

      const variables = [
        { key: 'API_URL', value: 'http://localhost:3000', isSecret: false },
        { key: 'DB_NAME', value: 'testing', isSecret: false },
      ];

      const updated = await projectsService.updateEnvironmentVariables(project.id, devEnv.id, variables);
      expect(updated.variables).toHaveLength(2);
      expect((updated.variables as any)[0].key).toBe('API_URL');
    });

    it('should fail variable updates if duplicate keys are provided', async () => {
      const devEnv = projectsRepo.environments.find(e => e.projectId === project.id && e.slug === 'development');
      expect(devEnv).toBeDefined();

      const variables = [
        { key: 'API_URL', value: 'http://localhost:3000', isSecret: false },
        { key: 'API_URL', value: 'duplicate', isSecret: false },
      ];

      await expect(
        projectsService.updateEnvironmentVariables(project.id, devEnv.id, variables)
      ).rejects.toThrow(ValidationError);
    });

    it('should prevent developers from updating variables in protected environments', async () => {
      const prodEnv = projectsRepo.environments.find(e => e.projectId === project.id && e.slug === 'production');
      expect(prodEnv).toBeDefined();

      const variables = [{ key: 'URL', value: 'https://api.acme.com', isSecret: false }];

      // Developer user trying to update
      const devUserPayload = { id: 'dev-1', role: 'member', projectRole: 'developer' };

      await expect(
        projectsService.updateEnvironmentVariables(project.id, prodEnv.id, variables, devUserPayload)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow project admins to update variables in protected environments', async () => {
      const prodEnv = projectsRepo.environments.find(e => e.projectId === project.id && e.slug === 'production');
      expect(prodEnv).toBeDefined();

      const variables = [{ key: 'URL', value: 'https://api.acme.com', isSecret: false }];

      const adminUserPayload = { id: mockUserId, role: 'member', projectRole: 'admin' };
      const updated = await projectsService.updateEnvironmentVariables(project.id, prodEnv.id, variables, adminUserPayload);

      expect(updated.variables).toHaveLength(1);
    });

    it('should prevent deletion of protected or production environments', async () => {
      const prodEnv = projectsRepo.environments.find(e => e.projectId === project.id && e.slug === 'production');
      expect(prodEnv).toBeDefined();

      await expect(
        projectsService.deleteEnvironment(project.id, prodEnv.id)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Project Membership Operations', () => {
    let project: any;
    const targetUser = 'user-abc';

    beforeEach(async () => {
      project = await projectsService.createProject(mockUserId, 'acme-corp', { name: 'Core API', description: '', visibility: 'private', tags: [] });
    });

    it('should add project members', async () => {
      // Setup membership in org first
      await orgRepo.createMembership({
        organizationId: mockOrg.id,
        userId: targetUser,
        role: 'member',
        status: 'active',
        invitedBy: mockUserId,
      });

      const member = await projectsService.addMember(project.id, mockUserId, {
        userId: targetUser,
        role: 'developer',
      });

      expect(member.userId).toBe(targetUser);
      expect(member.role).toBe('developer');
    });

    it('should prevent adding users that are not members of the organization', async () => {
      await expect(
        projectsService.addMember(project.id, mockUserId, {
          userId: 'stranger-danger',
          role: 'developer',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should prevent modifying the role of the sole project admin', async () => {
      const adminMember = projectsRepo.members.find(m => m.projectId === project.id && m.userId === mockUserId);
      expect(adminMember).toBeDefined();

      await expect(
        projectsService.updateMemberRole(project.id, mockUserId, { role: 'developer' })
      ).rejects.toThrow(ValidationError);
    });

    it('should prevent removing the sole project admin', async () => {
      await expect(
        projectsService.removeMember(project.id, mockUserId)
      ).rejects.toThrow(ValidationError);
    });
  });
});
