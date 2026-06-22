import { useEffect, useState } from 'react';
import { AppRoutes } from './router';
import { useAuthStore } from '../stores/auth.store';
import { useOrgStore } from '../stores/org.store';
import { refreshSession } from '../lib/api-client';
import axios from 'axios';
import { Cpu, Loader2 } from 'lucide-react';

export function App() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        // Attempt a silent refresh to fetch the initial accessToken if there is a valid refreshToken cookie
        const { accessToken } = await refreshSession();
        
        // Fetch active organization list
        const orgsResponse = await axios.get('/api/v1/me/organizations', {
          headers: { Authorization: `Bearer ${accessToken}` },
          withCredentials: true
        });
        const orgs = orgsResponse.data.data;
        useOrgStore.getState().setOrganizations(orgs);
        
        if (orgs.length > 0) {
          const storedOrgId = localStorage.getItem('activeOrgId');
          const exists = orgs.some((o: any) => o.id === storedOrgId);
          useOrgStore.getState().setActiveOrgId(exists ? storedOrgId : orgs[0].id);
        }
      } catch (err) {
        // Safe to clear auth if session does not exist
        clearAuth();
        useOrgStore.getState().clearOrgs();
      } finally {
        setInitializing(false);
      }
    };

    checkSession();
  }, [setAuth, clearAuth]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col items-center justify-center gap-4">
        <div className="bg-[#6366f1] p-3 rounded-2xl shadow-xl shadow-indigo-500/20 flex items-center justify-center animate-pulse">
          <Cpu className="w-8 h-8 text-white" />
        </div>
        <div className="flex items-center gap-2 text-neutral-400 font-medium text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          Initializing SELADEV Control Plane...
        </div>
      </div>
    );
  }

  return <AppRoutes />;
}
