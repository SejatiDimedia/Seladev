import type { OrganizationsRepository } from './organizations.repository';
import type { 
  CreateOrganizationDto, 
  InviteMemberDto, 
  UpdateMemberRoleDto,
  Organization,
  Membership,
  OrgRole
} from './organizations.types';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import mongoose from 'mongoose';

export class OrganizationsService {
  constructor(private readonly orgRepo: OrganizationsRepository) {}

  async createOrg(
    userId: string,
    dto: CreateOrganizationDto
  ): Promise<{ organization: Organization; membership: Membership }> {
    const existingOrg = await this.orgRepo.findOrgBySlug(dto.slug);
    if (existingOrg) {
      throw new ConflictError(`Organization with slug "${dto.slug}" already exists`);
    }

    // 1. Create Organization
    const orgDoc = await this.orgRepo.createOrg({
      name: dto.name,
      slug: dto.slug,
      createdBy: userId,
    });

    // 2. Create owner membership (FR-ORG-01: creator is owner/admin)
    const membershipDoc = await this.orgRepo.createMembership({
      organizationId: orgDoc.id,
      userId,
      role: 'owner',
      invitedBy: userId,
      status: 'active',
      joinedAt: new Date(),
    });

    return {
      organization: orgDoc.toJSON() as unknown as Organization,
      membership: membershipDoc.toJSON() as unknown as Membership,
    };
  }

  async getOrg(orgId: string): Promise<Organization> {
    const orgDoc = await this.orgRepo.findOrgById(orgId);
    if (!orgDoc) {
      throw new NotFoundError('Organization', orgId);
    }
    return orgDoc.toJSON() as unknown as Organization;
  }

  async inviteMember(
    orgId: string,
    invitedBy: string,
    dto: InviteMemberDto
  ): Promise<Membership> {
    const userDoc = await this.orgRepo.findUserByEmail(dto.email);
    if (!userDoc) {
      // In a production app, we would send an email and save an pendingInvitation.
      // For the MVP, we require the user to already exist or throw a NotFoundError/ValidationError.
      throw new NotFoundError('User with email', dto.email);
    }

    const existingMembership = await this.orgRepo.findMembership(orgId, userDoc.id);
    if (existingMembership) {
      throw new ConflictError('User is already a member of this organization');
    }

    const membershipDoc = await this.orgRepo.createMembership({
      organizationId: orgId,
      userId: userDoc.id,
      role: dto.role as OrgRole,
      invitedBy,
      status: 'active', // Direct addition for local dev/MVP ease of use
      joinedAt: new Date(),
    });

    return membershipDoc.toJSON() as unknown as Membership;
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    dto: UpdateMemberRoleDto
  ): Promise<Membership> {
    const membership = await this.orgRepo.findMembership(orgId, userId);
    if (!membership) {
      throw new NotFoundError('Membership', `${orgId}/${userId}`);
    }

    if (membership.role === 'owner' && (dto.role as OrgRole) !== 'owner') {
      // Check if this is the sole owner
      const memberships = await this.orgRepo.findMembershipsByOrg(orgId);
      const owners = memberships.filter(m => m.role === 'owner' && m.status === 'active');
      if (owners.length <= 1) {
        throw new ValidationError([], 'Cannot change the role of the sole organization owner');
      }
    }

    membership.role = dto.role as OrgRole;
    await membership.save();

    return membership.toJSON() as unknown as Membership;
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const membership = await this.orgRepo.findMembership(orgId, userId);
    if (!membership) {
      throw new NotFoundError('Membership', `${orgId}/${userId}`);
    }

    if (membership.role === 'owner') {
      // Check if this is the sole owner
      const memberships = await this.orgRepo.findMembershipsByOrg(orgId);
      const owners = memberships.filter(m => m.role === 'owner' && m.status === 'active');
      if (owners.length <= 1) {
        throw new ValidationError([], 'Cannot remove the sole organization owner');
      }
    }

    await this.orgRepo.deleteMembership(membership.id);

    // FR-ORG-04: also remove all project-level role assignments
    // For now we import model directly or handle in project members repository later.
    await mongoose.model('ProjectMember').deleteMany({ userId }).exec();
  }

  async getMembers(orgId: string): Promise<Membership[]> {
    const memberships = await this.orgRepo.findMembershipsByOrg(orgId);
    return memberships.map(m => m.toJSON() as unknown as Membership);
  }
}
