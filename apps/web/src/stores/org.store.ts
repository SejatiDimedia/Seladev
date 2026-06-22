import { create } from 'zustand';

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface OrgState {
  activeOrgId: string | null;
  organizations: Organization[];
  setActiveOrgId: (orgId: string | null) => void;
  setOrganizations: (orgs: Organization[]) => void;
  clearOrgs: () => void;
}

export const useOrgStore = create<OrgState>((set) => ({
  activeOrgId: localStorage.getItem('activeOrgId'),
  organizations: [],
  setActiveOrgId: (orgId) => {
    if (orgId) {
      localStorage.setItem('activeOrgId', orgId);
    } else {
      localStorage.removeItem('activeOrgId');
    }
    set({ activeOrgId: orgId });
  },
  setOrganizations: (orgs) => set({ organizations: orgs }),
  clearOrgs: () => {
    localStorage.removeItem('activeOrgId');
    set({ activeOrgId: null, organizations: [] });
  },
}));
