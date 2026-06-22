import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useOrgStore, Organization } from '../../stores/org.store';
import { apiClient } from '../../lib/api-client';
import { NotificationDrawer } from './NotificationDrawer';
import { MfaSettingsModal } from '../../features/auth/components/MfaSettingsModal';
import { Modal } from '../ui/Modal';
import {
  Cpu,
  Layers,
  Key,
  Shield,
  ShieldAlert,
  Radio,
  BarChart3,
  Bell,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Plus,
  Loader2
} from 'lucide-react';
import clsx from 'clsx';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const setAuth = useAuthStore((state) => state.setAuth);
  
  const activeOrgId = useOrgStore((state) => state.activeOrgId);
  const organizations = useOrgStore((state) => state.organizations);
  const setActiveOrgId = useOrgStore((state) => state.setActiveOrgId);
  const setOrganizations = useOrgStore((state) => state.setOrganizations);
  const clearOrgs = useOrgStore((state) => state.clearOrgs);

  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createOrgLoading, setCreateOrgLoading] = useState(false);
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [showInviteMemberModal, setShowInviteMemberModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  useEffect(() => {
    if (!showInviteMemberModal) {
      setInviteEmail('');
      setInviteRole('member');
      setInviteError(null);
      setInviteSuccess(false);
    }
  }, [showInviteMemberModal]);

  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  useEffect(() => {
    // If authenticated, fetch user's organizations
    const loadOrgs = async () => {
      try {
        const response = await apiClient.get('/me/organizations');
        const orgs = response.data.data;
        setOrganizations(orgs);

        if (orgs.length > 0) {
          // If no activeOrgId or it's not present in the current organizations list
          if (!activeOrgId || !orgs.some((o: Organization) => o.id === activeOrgId)) {
            setActiveOrgId(orgs[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load organizations', err);
      }
    };

    loadOrgs();
  }, [activeOrgId, setOrganizations, setActiveOrgId]);

  const handleSwitchOrg = async (orgId: string) => {
    setOrgDropdownOpen(false);
    try {
      const response = await apiClient.post('/auth/switch-org', { orgId });
      const { accessToken, user } = response.data.data;
      setAuth(accessToken, user);
      setActiveOrgId(orgId);
      navigate('/');
    } catch (err) {
      console.error('Failed to switch organization', err);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;

    setCreateOrgLoading(true);
    try {
      let slug = newOrgName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      if (slug.length < 3) {
        slug = `${slug}-org`;
      }

      const response = await apiClient.post('/organizations', { name: newOrgName, slug });
      const createdOrg = response.data.data;
      
      const updatedOrgs = [...organizations, { id: createdOrg.id, name: createdOrg.name, slug: createdOrg.slug }];
      setOrganizations(updatedOrgs);

      // Switch to the newly created organization on the backend to synchronize session
      const switchResponse = await apiClient.post('/auth/switch-org', { orgId: createdOrg.id });
      const { accessToken, user } = switchResponse.data.data;
      setAuth(accessToken, user);
      setActiveOrgId(createdOrg.id);
      
      setShowCreateOrgModal(false);
      setNewOrgName('');
      navigate('/');
    } catch (err) {
      console.error('Failed to create organization', err);
    } finally {
      setCreateOrgLoading(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !activeOrgId) return;

    setInviteLoading(true);
    setInviteError(null);
    setInviteSuccess(false);
    try {
      await apiClient.post(`/organizations/${activeOrgId}/members`, {
        email: inviteEmail,
        role: inviteRole
      });
      setInviteSuccess(true);
      setInviteEmail('');
      setInviteRole('member');
      setTimeout(() => {
        setShowInviteMemberModal(false);
      }, 2000);
    } catch (err: any) {
      setInviteError(err.message || 'Failed to invite member to workspace');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (err) {
      console.error('Logout error', err);
    } finally {
      clearAuth();
      clearOrgs();
      navigate('/login');
    }
  };

  const navigation = [
    { name: 'Projects', to: '/projects', icon: Layers },
    { name: 'API Keys', to: '/api-keys', icon: Key },
    { name: 'Audit Logs', to: '/audit-logs', icon: ShieldAlert },
    { name: 'Webhooks', to: '/webhooks', icon: Radio },
    { name: 'Analytics', to: '/analytics', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col md:flex-row selection:bg-[#6366f1] selection:text-[#ffffff]">
      {/* Decorative Blur Backgrounds */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[#6366f1] opacity-[0.03] blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-[#a855f7] opacity-[0.03] blur-[120px] rounded-full pointer-events-none"></div>

      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex md:w-64 flex-col border-r border-white/5 bg-[#09090b]/80 backdrop-blur-md sticky top-0 h-screen z-40">
        {/* Brand Logo */}
        <div className="p-6 flex items-center gap-3 border-b border-white/5">
          <div className="bg-[#6366f1] p-2 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">SELADEV</span>
            <span className="text-[9px] uppercase font-bold tracking-widest text-[#6366f1] block leading-none">Control Plane</span>
          </div>
        </div>

        {/* Workspace Switcher */}
        <div className="px-4 py-4 border-b border-white/5 relative">
          <label className="text-[10px] uppercase font-bold tracking-widest text-neutral-500 block mb-1.5 px-2">Workspace</label>
          <button
            onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-white/5 border border-white/5 rounded-xl text-sm font-medium hover:bg-white/10 transition-all text-white"
          >
            <span className="truncate">{activeOrg?.name || 'Select Workspace...'}</span>
            <ChevronDown className="w-4 h-4 text-neutral-400" />
          </button>

          {orgDropdownOpen && (
            <div className="absolute left-4 right-4 mt-2 bg-neutral-900 border border-white/10 rounded-xl shadow-xl z-50 py-1.5 max-h-60 overflow-y-auto backdrop-blur-md">
              {organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleSwitchOrg(org.id)}
                  className={clsx(
                    'w-full text-left px-4 py-2 text-xs font-medium transition-colors hover:bg-white/5',
                    org.id === activeOrgId ? 'text-indigo-400 bg-indigo-500/5' : 'text-neutral-300'
                  )}
                >
                  {org.name}
                </button>
              ))}
              <div className="border-t border-white/5 my-1.5"></div>
              <button
                onClick={() => {
                  setOrgDropdownOpen(false);
                  setShowCreateOrgModal(true);
                }}
                className="w-full text-left px-4 py-2 text-xs font-medium text-indigo-400 hover:bg-white/5 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                New Workspace
              </button>
              {activeOrgId && (
                <button
                  onClick={() => {
                    setOrgDropdownOpen(false);
                    setShowInviteMemberModal(true);
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-indigo-400 hover:bg-white/5 transition-colors flex items-center gap-1.5 mt-0.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Invite Member
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar Nav */}
        <nav className="flex-grow px-4 py-6 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.name}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative',
                    isActive
                      ? 'bg-indigo-500/10 text-white border border-indigo-500/20 shadow-lg shadow-indigo-500/5'
                      : 'text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={clsx('w-4.5 h-4.5 transition-colors', isActive ? 'text-indigo-400' : 'text-neutral-500 group-hover:text-neutral-400')} />
                    {item.name}
                    {isActive && (
                      <span className="absolute right-3 w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-white/5 relative">
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-all text-left"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white uppercase">
              {user?.name?.slice(0, 2) || 'US'}
            </div>
            <div className="flex-grow min-w-0">
              <p className="text-xs font-bold text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-neutral-500 truncate">{user?.email}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-neutral-500" />
          </button>

          {profileDropdownOpen && (
            <div className="absolute bottom-16 left-4 right-4 bg-neutral-900 border border-white/10 rounded-xl shadow-xl z-50 py-1.5 backdrop-blur-md">
              <div className="px-4 py-2 border-b border-white/5">
                <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">Role</span>
                <span className="text-xs font-semibold text-neutral-300">
                  {user?.isPlatformAdmin ? 'Platform Admin' : 'Workspace Member'}
                </span>
              </div>
              <button
                onClick={() => {
                  setProfileDropdownOpen(false);
                  setShowMfaModal(true);
                }}
                className="w-full text-left px-4 py-2.5 text-xs font-medium text-neutral-300 hover:bg-white/5 transition-colors flex items-center gap-2 mt-1.5"
              >
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                MFA Settings
              </button>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/5 transition-colors flex items-center gap-2 mt-0.5 border-t border-white/5 pt-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-grow flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="sticky top-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 z-30 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile Menu trigger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 hover:bg-white/5 rounded-lg text-neutral-400 hover:text-white transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="font-bold text-sm text-neutral-400 tracking-wide uppercase hidden md:block">
              {location.pathname.split('/')[1] || 'Dashboard'}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            {/* Notification Bell */}
            <button
              onClick={() => setNotificationDrawerOpen(true)}
              className="p-2 hover:bg-white/5 border border-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors relative"
            >
              <Bell className="w-4.5 h-4.5" />
              {unreadNotificationCount > 0 && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-indigo-500 rounded-full border-2 border-[#09090b] flex items-center justify-center">
                  <span className="absolute w-full h-full bg-indigo-500 rounded-full animate-ping opacity-75"></span>
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Route Pages Output */}
        <main className="flex-grow p-6 md:p-10 max-w-7xl w-full mx-auto">
          {organizations.length === 0 ? (
            <div className="glass-card p-12 rounded-3xl border border-white/10 text-center max-w-lg mx-auto space-y-6 my-20">
              <Cpu className="w-12 h-12 text-indigo-400 mx-auto" />
              <h3 className="text-xl font-bold text-white">No Workspaces Found</h3>
              <p className="text-sm text-neutral-400 leading-relaxed font-light">
                Every user requires an organization workspace to proceed. Please create a new workspace to start deployment pipelines, secrets storage, and audit logging.
              </p>
              <form onSubmit={handleCreateOrg} className="space-y-4">
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Organization Name (e.g. Acme Corp)"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors text-center"
                />
                <button
                  type="submit"
                  disabled={createOrgLoading || !newOrgName.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-all"
                >
                  {createOrgLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> : 'Create Workspace'}
                </button>
              </form>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <>
          <div onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] md:hidden"></div>
          <div className="fixed top-0 left-0 bottom-0 w-64 bg-[#09090b] border-r border-white/5 z-[10000] p-6 flex flex-col gap-6 md:hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Cpu className="w-5 h-5 text-indigo-400" />
                <span className="font-extrabold text-white">SELADEV</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1 text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold tracking-widest text-neutral-500 block mb-1">Active Workspace</label>
              <div className="px-3 py-2 bg-white/5 rounded-xl border border-white/5 text-sm text-white truncate font-medium">
                {activeOrg?.name}
              </div>
            </div>

            <nav className="flex-grow space-y-1.5">
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.name}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                        isActive ? 'bg-indigo-500/10 text-white border border-indigo-500/20' : 'text-neutral-400 hover:text-white hover:bg-white/5'
                      )
                    }
                  >
                    <Icon className="w-4.5 h-4.5 text-neutral-400" />
                    {item.name}
                  </NavLink>
                );
              })}
            </nav>

            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/5 transition-all mt-auto"
            >
              <LogOut className="w-4.5 h-4.5" />
              Sign Out
            </button>
          </div>
        </>
      )}

      {/* Create Organization Modal */}
      {showCreateOrgModal && (
        <>
          <div onClick={() => setShowCreateOrgModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-2xl z-[10000] shadow-xl space-y-4">
            <h3 className="font-bold text-lg text-white">Create New Workspace</h3>
            <p className="text-xs text-neutral-400">Collaborate on environments, secrets, API keys, and deployment pipelines with team members.</p>
            <form onSubmit={handleCreateOrg} className="space-y-4">
              <input
                type="text"
                required
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Workspace name (e.g. Engineering)"
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <div className="flex justify-end gap-3 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setShowCreateOrgModal(false)}
                  className="px-4 py-2 hover:bg-white/5 rounded-lg text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createOrgLoading || !newOrgName.trim()}
                  className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {createOrgLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Modal: Invite Member */}
      <Modal
        isOpen={showInviteMemberModal}
        onClose={() => setShowInviteMemberModal(false)}
        title="Invite Member to Workspace"
        description={`Add a registered user to the "${activeOrg?.name || 'Workspace'}" organization.`}
      >
        {inviteError && (
          <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 animate-pulse" />
            <span className="font-medium">{inviteError}</span>
          </div>
        )}

        {inviteSuccess && (
          <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="font-medium">User successfully invited to the workspace!</span>
          </div>
        )}

        <form onSubmit={handleInviteMember} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">User Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="collaborator@company.com"
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Organization Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as any)}
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors text-white"
            >
              <option value="viewer">Viewer (Read access to workspace resources)</option>
              <option value="member">Member (Create and manage projects and configurations)</option>
              <option value="admin">Admin (Manage users, billing, and full workspace settings)</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
            <button
              type="button"
              onClick={() => setShowInviteMemberModal(false)}
              className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviteLoading || !inviteEmail.trim()}
              className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
            >
              {inviteLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Invite Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Notifications Drawer */}
      <NotificationDrawer
        isOpen={notificationDrawerOpen}
        onClose={() => setNotificationDrawerOpen(false)}
        onUnreadCountChange={setUnreadNotificationCount}
      />

      {/* MFA Settings Modal */}
      <MfaSettingsModal
        isOpen={showMfaModal}
        onClose={() => setShowMfaModal(false)}
      />
    </div>
  );
}
