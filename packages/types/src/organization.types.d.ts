import type { OrgRole } from './rbac.types';
export interface OrganizationSettings {
    mfaRequired: boolean;
    allowedDomains: string[];
    maxProjects: number;
    maxMembers: number;
}
export interface Organization {
    id: string;
    name: string;
    slug: string;
    plan: 'free' | 'pro' | 'enterprise';
    settings: OrganizationSettings;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
export interface Membership {
    id: string;
    organizationId: string;
    userId: string;
    role: OrgRole;
    invitedBy: string;
    status: 'active' | 'invited' | 'suspended';
    joinedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
//# sourceMappingURL=organization.types.d.ts.map