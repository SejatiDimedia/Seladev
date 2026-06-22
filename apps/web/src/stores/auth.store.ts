import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  activeOrgId: string | null;
  mfaEnabled: boolean;
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
  requiresMfa: boolean;
  mfaToken: string | null;
  setAuth: (token: string, user: User) => void;
  setMfaRequired: (mfaToken: string, user: User) => void;
  setAccessToken: (token: string) => void;
  updateUser: (user: Partial<User>) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  requiresMfa: false,
  mfaToken: null,
  setAuth: (token, user) => set({ accessToken: token, user, requiresMfa: false, mfaToken: null }),
  setMfaRequired: (mfaToken, user) => set({ accessToken: null, user, requiresMfa: true, mfaToken }),
  setAccessToken: (token) => set({ accessToken: token }),
  updateUser: (updates) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    })),
  clearAuth: () => set({ accessToken: null, user: null, requiresMfa: false, mfaToken: null }),
}));
