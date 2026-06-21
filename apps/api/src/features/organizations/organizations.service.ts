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
  constructor(
    private readonly orgRepo: OrganizationsRepository,
    private readonly webhookPublisher?: any,
    private readonly notificationsService?: any
  ) {}

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

    if (this.webhookPublisher) {
      this.webhookPublisher.publish('member.invited', orgId, null, {
        invitation: {
          inviteeEmail: dto.email,
          orgRole: dto.role,
          invitedBy,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }
      }).catch((err: any) => console.error('Failed to publish webhook:', err));

      this.webhookPublisher.publish('member.joined', orgId, null, {
        member: {
          userId: userDoc.id,
          role: dto.role,
          joinedAt: new Date().toISOString(),
        }
      }).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

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

    if (this.notificationsService) {
      const org = await this.orgRepo.findOrgById(orgId);
      const orgName = org ? org.name : 'Unknown';
      await this.notificationsService.createNotification(
        userId,
        orgId,
        'role.changed',
        'Organization Role Updated',
        `Your role in organization "${orgName}" has been updated to "${dto.role}".`,
        `/settings`
      ).catch((err: any) => console.error('Failed to notify organization role change:', err));
    }

    if (this.webhookPublisher) {
      this.webhookPublisher.publish('member.role_changed', orgId, null, {
        member: {
          userId,
          role: dto.role,
        }
      }).catch((err: any) => console.error('Failed to publish webhook:', err));
    }

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

    if (this.webhookPublisher) {
      this.webhookPublisher.publish('member.removed', orgId, null, {
        member: {
          userId,
        }
      }).catch((err: any) => console.error('Failed to publish webhook:', err));
    }
  }

  async getMembers(orgId: string): Promise<Membership[]> {
    const memberships = await this.orgRepo.findMembershipsByOrg(orgId);
    return memberships.map(m => m.toJSON() as unknown as Membership);
  }

  async getUserOrgs(userId: string): Promise<Organization[]> {
    const memberships = await this.orgRepo.findMembershipsByUser(userId);
    return memberships
      .map(m => m.organizationId)
      .filter((org): org is any => org !== null)
      .map(org => {
        if (typeof org.toJSON === 'function') {
          return org.toJSON() as unknown as Organization;
        }
        return org as unknown as Organization;
      });
  }
}
