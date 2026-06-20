export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ProjectRole = 'admin' | 'developer' | 'viewer';

export interface UserPermissions {
  orgId: string;
  role: OrgRole;
  projects: {
    projectId: string;
    role: ProjectRole;
  }[];
}
