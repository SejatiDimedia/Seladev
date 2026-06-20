import mongoose from 'mongoose';
import type { OrganizationDocument } from '../../infrastructure/database/models/organization.model';
import { OrganizationModel } from '../../infrastructure/database/models/organization.model';
import type { MembershipDocument } from '../../infrastructure/database/models/membership.model';
import { MembershipModel } from '../../infrastructure/database/models/membership.model';
import type { UserDocument } from '../../infrastructure/database/models/user.model';
import { UserModel } from '../../infrastructure/database/models/user.model';
import type { OrgRole } from './organizations.types';

export interface OrganizationsRepository {
  findOrgById(id: string): Promise<OrganizationDocument | null>;
  findOrgBySlug(slug: string): Promise<OrganizationDocument | null>;
  createOrg(data: { name: string; slug: string; createdBy: string }): Promise<OrganizationDocument>;
  
  // Membership operations
  createMembership(data: {
    organizationId: string;
    userId: string;
    role: OrgRole;
    invitedBy: string;
    status: 'active' | 'invited' | 'suspended';
    joinedAt?: Date | null;
  }): Promise<MembershipDocument>;
  findMembership(orgId: string, userId: string): Promise<MembershipDocument | null>;
  findMembershipsByOrg(orgId: string): Promise<MembershipDocument[]>;
  updateMembership(id: string, update: Partial<MembershipDocument>): Promise<MembershipDocument | null>;
  deleteMembership(id: string): Promise<boolean>;
  countOrgMembers(orgId: string): Promise<number>;
  
  // User operations (helper to lookup users for invitations)
  findUserByEmail(email: string): Promise<UserDocument | null>;
}

export class MongooseOrganizationsRepository implements OrganizationsRepository {
  async findOrgById(id: string): Promise<OrganizationDocument | null> {
    return OrganizationModel.findById(id).exec();
  }

  async findOrgBySlug(slug: string): Promise<OrganizationDocument | null> {
    return OrganizationModel.findOne({ slug }).exec();
  }

  async createOrg(data: { name: string; slug: string; createdBy: string }): Promise<OrganizationDocument> {
    return OrganizationModel.create({
      name: data.name,
      slug: data.slug,
      createdBy: new mongoose.Types.ObjectId(data.createdBy),
    });
  }

  async createMembership(data: {
    organizationId: string;
    userId: string;
    role: OrgRole;
    invitedBy: string;
    status: 'active' | 'invited' | 'suspended';
    joinedAt?: Date | null;
  }): Promise<MembershipDocument> {
    return MembershipModel.create({
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      userId: new mongoose.Types.ObjectId(data.userId),
      role: data.role,
      invitedBy: new mongoose.Types.ObjectId(data.invitedBy),
      status: data.status,
      joinedAt: data.joinedAt || null,
    });
  }

  async findMembership(orgId: string, userId: string): Promise<MembershipDocument | null> {
    return MembershipModel.findOne({
      organizationId: new mongoose.Types.ObjectId(orgId),
      userId: new mongoose.Types.ObjectId(userId),
    }).populate('userId').exec();
  }

  async findMembershipsByOrg(orgId: string): Promise<MembershipDocument[]> {
    return MembershipModel.find({
      organizationId: new mongoose.Types.ObjectId(orgId),
    }).populate('userId').exec();
  }

  async updateMembership(id: string, update: Partial<MembershipDocument>): Promise<MembershipDocument | null> {
    return MembershipModel.findByIdAndUpdate(id, update, { new: true }).populate('userId').exec();
  }

  async deleteMembership(id: string): Promise<boolean> {
    const result = await MembershipModel.findByIdAndDelete(id).exec();
    return result !== null;
  }

  async countOrgMembers(orgId: string): Promise<number> {
    return MembershipModel.countDocuments({
      organizationId: new mongoose.Types.ObjectId(orgId),
      status: 'active',
    }).exec();
  }

  async findUserByEmail(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email }).exec();
  }
}
