import mongoose from 'mongoose';
import type { ProjectDocument } from '../../infrastructure/database/models/project.model';
import { ProjectModel } from '../../infrastructure/database/models/project.model';
import type { EnvironmentDocument } from '../../infrastructure/database/models/environment.model';
import { EnvironmentModel } from '../../infrastructure/database/models/environment.model';
import type { ProjectMemberDocument } from '../../infrastructure/database/models/project-member.model';
import { ProjectMemberModel } from '../../infrastructure/database/models/project-member.model';
import type { ProjectRole } from './projects.types';

export interface ProjectsRepository {
  // Project operations
  findProjectById(id: string): Promise<ProjectDocument | null>;
  findProjectBySlug(orgId: string, slug: string): Promise<ProjectDocument | null>;
  createProject(data: {
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
    visibility?: 'private' | 'internal';
    repositoryUrl?: string | null;
    tags?: string[];
    settings?: {
      deploymentProtection?: boolean;
      requireApproval?: boolean;
      allowedBranches?: string[];
    };
    createdBy: string;
  }): Promise<ProjectDocument>;
  updateProject(id: string, update: Partial<ProjectDocument>): Promise<ProjectDocument | null>;
  listProjectsByOrg(orgId: string): Promise<ProjectDocument[]>;

  // Environment operations
  createEnvironment(data: {
    organizationId: string;
    projectId: string;
    name: string;
    slug: string;
    type: 'development' | 'staging' | 'production';
    isProtected?: boolean;
    description?: string;
    variables?: { key: string; value: string; isSecret: boolean }[];
  }): Promise<EnvironmentDocument>;
  findEnvironmentById(id: string): Promise<EnvironmentDocument | null>;
  findEnvironmentBySlug(projectId: string, slug: string): Promise<EnvironmentDocument | null>;
  listEnvironmentsByProject(projectId: string): Promise<EnvironmentDocument[]>;
  updateEnvironment(id: string, update: Partial<EnvironmentDocument>): Promise<EnvironmentDocument | null>;
  deleteEnvironment(id: string): Promise<boolean>;

  // Project member operations
  addProjectMember(data: {
    projectId: string;
    userId: string;
    role: ProjectRole;
    assignedBy: string;
  }): Promise<ProjectMemberDocument>;
  findProjectMember(projectId: string, userId: string): Promise<ProjectMemberDocument | null>;
  findProjectMemberById(id: string): Promise<ProjectMemberDocument | null>;
  listProjectMembers(projectId: string): Promise<ProjectMemberDocument[]>;
  updateProjectMemberRole(id: string, role: ProjectRole): Promise<ProjectMemberDocument | null>;
  removeProjectMember(id: string): Promise<boolean>;
  countProjectMembers(projectId: string): Promise<number>;
}

export class MongooseProjectsRepository implements ProjectsRepository {
  // Project operations
  async findProjectById(id: string): Promise<ProjectDocument | null> {
    return ProjectModel.findById(id).exec();
  }

  async findProjectBySlug(orgId: string, slug: string): Promise<ProjectDocument | null> {
    return ProjectModel.findOne({
      organizationId: new mongoose.Types.ObjectId(orgId),
      slug: slug.toLowerCase(),
    }).exec();
  }

  async createProject(data: {
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
    visibility?: 'private' | 'internal';
    repositoryUrl?: string | null;
    tags?: string[];
    settings?: {
      deploymentProtection?: boolean;
      requireApproval?: boolean;
      allowedBranches?: string[];
    };
    createdBy: string;
  }): Promise<ProjectDocument> {
    return ProjectModel.create({
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      name: data.name,
      slug: data.slug.toLowerCase(),
      description: data.description || '',
      visibility: data.visibility || 'private',
      repositoryUrl: data.repositoryUrl || null,
      tags: data.tags || [],
      settings: data.settings || {
        deploymentProtection: false,
        requireApproval: false,
        allowedBranches: [],
      },
      createdBy: new mongoose.Types.ObjectId(data.createdBy),
    });
  }

  async updateProject(id: string, update: Partial<ProjectDocument>): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async listProjectsByOrg(orgId: string): Promise<ProjectDocument[]> {
    return ProjectModel.find({
      organizationId: new mongoose.Types.ObjectId(orgId),
      archivedAt: null,
    }).exec();
  }

  // Environment operations
  async createEnvironment(data: {
    organizationId: string;
    projectId: string;
    name: string;
    slug: string;
    type: 'development' | 'staging' | 'production';
    isProtected?: boolean;
    description?: string;
    variables?: { key: string; value: string; isSecret: boolean }[];
  }): Promise<EnvironmentDocument> {
    return EnvironmentModel.create({
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      projectId: new mongoose.Types.ObjectId(data.projectId),
      name: data.name,
      slug: data.slug.toLowerCase(),
      type: data.type,
      isProtected: data.isProtected ?? false,
      description: data.description || '',
      variables: data.variables || [],
    });
  }

  async findEnvironmentById(id: string): Promise<EnvironmentDocument | null> {
    return EnvironmentModel.findById(id).exec();
  }

  async findEnvironmentBySlug(projectId: string, slug: string): Promise<EnvironmentDocument | null> {
    return EnvironmentModel.findOne({
      projectId: new mongoose.Types.ObjectId(projectId),
      slug: slug.toLowerCase(),
    }).exec();
  }

  async listEnvironmentsByProject(projectId: string): Promise<EnvironmentDocument[]> {
    return EnvironmentModel.find({
      projectId: new mongoose.Types.ObjectId(projectId),
    }).exec();
  }

  async updateEnvironment(id: string, update: Partial<EnvironmentDocument>): Promise<EnvironmentDocument | null> {
    return EnvironmentModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async deleteEnvironment(id: string): Promise<boolean> {
    const result = await EnvironmentModel.findByIdAndDelete(id).exec();
    return result !== null;
  }

  // Project member operations
  async addProjectMember(data: {
    projectId: string;
    userId: string;
    role: ProjectRole;
    assignedBy: string;
  }): Promise<ProjectMemberDocument> {
    return ProjectMemberModel.create({
      projectId: new mongoose.Types.ObjectId(data.projectId),
      userId: new mongoose.Types.ObjectId(data.userId),
      role: data.role,
      assignedBy: new mongoose.Types.ObjectId(data.assignedBy),
    });
  }

  async findProjectMember(projectId: string, userId: string): Promise<ProjectMemberDocument | null> {
    return ProjectMemberModel.findOne({
      projectId: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    }).populate('userId').exec();
  }

  async findProjectMemberById(id: string): Promise<ProjectMemberDocument | null> {
    return ProjectMemberModel.findById(id).populate('userId').exec();
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberDocument[]> {
    return ProjectMemberModel.find({
      projectId: new mongoose.Types.ObjectId(projectId),
    }).populate('userId').exec();
  }

  async updateProjectMemberRole(id: string, role: ProjectRole): Promise<ProjectMemberDocument | null> {
    return ProjectMemberModel.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).populate('userId').exec();
  }

  async removeProjectMember(id: string): Promise<boolean> {
    const result = await ProjectMemberModel.findByIdAndDelete(id).exec();
    return result !== null;
  }

  async countProjectMembers(projectId: string): Promise<number> {
    return ProjectMemberModel.countDocuments({
      projectId: new mongoose.Types.ObjectId(projectId),
    }).exec();
  }
}
