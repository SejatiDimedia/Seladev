import { useState, useEffect, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../../../lib/api-client';
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog';
import { Modal } from '../../../components/ui/Modal';

import {
  Layers,
  Users,
  GitBranch,
  Play,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Loader2,
  Lock,
  ChevronRight,
  Clock,
  Activity,
  History,
  Pencil
} from 'lucide-react';
import clsx from 'clsx';

interface Environment {
  id: string;
  name: string;
  type: string;
  isProtected: boolean;
  variables: Array<{ key: string; value: string; isSecret: boolean }>;
}

interface Secret {
  id: string;
  key: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface Deployment {
  id: string;
  environmentName: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  branch: string;
  commitHash?: string;
  commitMessage?: string;
  triggeredBy: { name: string; email: string };
  createdAt: string;
  completedAt?: string;
}

interface Member {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'developer' | 'viewer';
}

interface SecretVersion {
  id: string;
  version: number;
  createdAt: string;
  createdBy: { name: string };
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [project, setProject] = useState<any>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'envs' | 'deployments' | 'members'>('envs');

  // Secrets states
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [showAddSecretModal, setShowAddSecretModal] = useState(false);
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretVal, setNewSecretVal] = useState('');
  const [newSecretDesc, setNewSecretDesc] = useState('');
  const [secretActionLoading, setSecretActionLoading] = useState(false);
  const [showEditSecretModal, setShowEditSecretModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
  const [editSecretVal, setEditSecretVal] = useState('');

  // Versions modal states
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [selectedSecretForVersions, setSelectedSecretForVersions] = useState<Secret | null>(null);
  const [secretVersions, setSecretVersions] = useState<SecretVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Confirmation Dialog states
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info' | 'success';
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => { },
  });

  // Deployments state
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [showTriggerDeployModal, setShowTriggerDeployModal] = useState(false);
  const [deployEnvId, setDeployEnvId] = useState<string>('');
  const [deployBranch, setDeployBranch] = useState('main');
  const [deployCommitMsg, setDeployCommitMsg] = useState('');
  const [deployCommitHash, setDeployCommitHash] = useState('');
  const [triggerLoading, setTriggerLoading] = useState(false);

  // Members state
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'developer' | 'viewer'>('viewer');
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  useEffect(() => {
    if (!showAddMemberModal) {
      setAddMemberError(null);
    }
  }, [showAddMemberModal]);

  const selectedEnv = environments.find((e) => e.id === selectedEnvId);

  const fetchProjectDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const projRes = await apiClient.get(`/projects/${projectId}`);
      setProject(projRes.data.data);

      const envsRes = await apiClient.get(`/projects/${projectId}/environments`);
      const envsData = envsRes.data.data;
      setEnvironments(envsData);
      if (envsData.length > 0) {
        setSelectedEnvId(envsData[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load project details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjectDetails();
  }, [projectId]);

  // Load Secrets when selected environment changes
  useEffect(() => {
    const fetchSecrets = async () => {
      if (!selectedEnvId) return;
      setSecretsLoading(true);
      try {
        const response = await apiClient.get(`/projects/${projectId}/environments/${selectedEnvId}/secrets`);
        setSecrets(response.data.data);
        setRevealedSecrets({});
      } catch (err) {
        console.error('Failed to fetch secrets', err);
      } finally {
        setSecretsLoading(false);
      }
    };

    if (activeTab === 'envs') {
      fetchSecrets();
    }
  }, [selectedEnvId, activeTab, projectId]);

  // Load Deployments
  useEffect(() => {
    const fetchDeployments = async () => {
      setDeploymentsLoading(true);
      try {
        const response = await apiClient.get(`/projects/${projectId}/deployments`);
        setDeployments(response.data.data);
      } catch (err) {
        console.error('Failed to fetch deployments', err);
      } finally {
        setDeploymentsLoading(false);
      }
    };

    if (activeTab === 'deployments') {
      fetchDeployments();
    }
  }, [activeTab, projectId]);

  // Load Members
  useEffect(() => {
    const fetchMembers = async () => {
      setMembersLoading(true);
      try {
        const response = await apiClient.get(`/projects/${projectId}/members`);
        setMembers(response.data.data);
      } catch (err) {
        console.error('Failed to fetch members', err);
      } finally {
        setMembersLoading(false);
      }
    };

    if (activeTab === 'members') {
      fetchMembers();
    }
  }, [activeTab, projectId]);

  const handleRevealSecret = async (secretId: string) => {
    if (revealedSecrets[secretId]) {
      // Toggle off
      setRevealedSecrets((prev) => {
        const updated = { ...prev };
        delete updated[secretId];
        return updated;
      });
      return;
    }

    try {
      const response = await apiClient.post(`/projects/${projectId}/secrets/${secretId}/reveal`);
      setRevealedSecrets((prev) => ({ ...prev, [secretId]: response.data.data.value }));
    } catch (err) {
      console.error('Failed to reveal secret', err);
    }
  };

  const handleAddSecret = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSecretKey.trim() || !newSecretVal.trim()) return;

    setSecretActionLoading(true);
    try {
      const response = await apiClient.post(`/projects/${projectId}/environments/${selectedEnvId}/secrets`, {
        key: newSecretKey,
        value: newSecretVal,
        description: newSecretDesc
      });
      setSecrets((prev) => [...prev, response.data.data]);
      setShowAddSecretModal(false);
      setNewSecretKey('');
      setNewSecretVal('');
      setNewSecretDesc('');
    } catch (err: any) {
      alert(err.message || 'Failed to add secret');
    } finally {
      setSecretActionLoading(false);
    }
  };

  const executeDeleteSecret = async (secretId: string) => {
    setSecretActionLoading(true);
    try {
      await apiClient.delete(`/projects/${projectId}/secrets/${secretId}`);
      setSecrets((prev) => prev.filter((s) => s.id !== secretId));
      setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
    } catch (err: any) {
      alert(err.message || 'Failed to delete secret');
    } finally {
      setSecretActionLoading(false);
    }
  };

  const handleDeleteSecret = (secretId: string) => {
    const secret = secrets.find((s) => s.id === secretId);
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Secret',
      description: `Are you sure you want to permanently delete the secret "${secret?.key || ''}"? This action cannot be undone.`,
      confirmText: 'Delete Secret',
      cancelText: 'Cancel',
      type: 'danger',
      onConfirm: () => executeDeleteSecret(secretId),
    });
  };

  const handleOpenEditSecret = (secret: Secret) => {
    setEditingSecret(secret);
    setEditSecretVal(revealedSecrets[secret.id] || '');
    setShowEditSecretModal(true);
  };

  const handleEditSecretSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingSecret || !editSecretVal.trim()) return;

    setSecretActionLoading(true);
    try {
      const response = await apiClient.patch(`/projects/${projectId}/secrets/${editingSecret.id}`, {
        value: editSecretVal
      });
      const updatedSecret = response.data.data;
      setSecrets((prev) => prev.map((s) => (s.id === updatedSecret.id ? updatedSecret : s)));
      if (revealedSecrets[editingSecret.id] !== undefined) {
        setRevealedSecrets((prev) => ({ ...prev, [editingSecret.id]: editSecretVal }));
      }
      setShowEditSecretModal(false);
      setEditingSecret(null);
      setEditSecretVal('');
    } catch (err: any) {
      alert(err.message || 'Failed to update secret');
    } finally {
      setSecretActionLoading(false);
    }
  };

  const handleOpenVersions = async (secret: Secret) => {
    setSelectedSecretForVersions(secret);
    setVersionsLoading(true);
    setShowVersionsModal(true);
    try {
      const response = await apiClient.get(`/projects/${projectId}/secrets/${secret.id}/versions`);
      setSecretVersions(response.data.data);
    } catch (err) {
      console.error('Failed to fetch versions', err);
    } finally {
      setVersionsLoading(false);
    }
  };

  const executeRollback = async (versionNumber: number) => {
    if (!selectedSecretForVersions) return;
    setSecretActionLoading(true);
    try {
      await apiClient.post(`/projects/${projectId}/secrets/${selectedSecretForVersions.id}/rollback`, {
        version: versionNumber
      });
      setShowVersionsModal(false);
      // Reload secrets
      const secretsRes = await apiClient.get(`/projects/${projectId}/environments/${selectedEnvId}/secrets`);
      setSecrets(secretsRes.data.data);
      setRevealedSecrets({});
      setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
    } catch (err: any) {
      alert(err.message || 'Rollback failed');
    } finally {
      setSecretActionLoading(false);
    }
  };

  const handleRollback = (version: SecretVersion) => {
    if (!selectedSecretForVersions) return;
    setShowVersionsModal(false);
    setConfirmConfig({
      isOpen: true,
      title: 'Rollback Secret',
      description: `Are you sure you want to rollback the secret "${selectedSecretForVersions.key}" to Version ${version.version}?`,
      confirmText: 'Yes, Rollback',
      cancelText: 'Cancel',
      type: 'warning',
      onConfirm: () => executeRollback(version.version),
      onCancel: () => {
        setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
        setShowVersionsModal(true);
      }
    });
  };

  const handleTriggerDeployment = async (e: FormEvent) => {
    e.preventDefault();
    const targetEnvId = deployEnvId || selectedEnvId;
    if (!targetEnvId) return;

    setTriggerLoading(true);
    try {
      const response = await apiClient.post(`/projects/${projectId}/deployments`, {
        environmentId: targetEnvId,
        branch: deployBranch,
        commitMessage: deployCommitMsg || undefined,
        commitHash: deployCommitHash || undefined
      });
      setShowTriggerDeployModal(false);
      setDeployBranch('main');
      setDeployCommitMsg('');
      setDeployCommitHash('');
      setDeployEnvId('');

      // If currently on deployments tab, append the new deployment
      if (activeTab === 'deployments') {
        setDeployments((prev) => [response.data.data, ...prev]);
      } else {
        setActiveTab('deployments');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to trigger deployment');
    } finally {
      setTriggerLoading(false);
    }
  };

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim()) return;

    setAddMemberLoading(true);
    setAddMemberError(null);
    try {
      const response = await apiClient.post(`/projects/${projectId}/members`, {
        email: newMemberEmail,
        role: newMemberRole
      });
      setMembers((prev) => [...prev, response.data.data]);
      setShowAddMemberModal(false);
      setNewMemberEmail('');
      setNewMemberRole('viewer');
    } catch (err: any) {
      setAddMemberError(err.message || 'Failed to add member');
    } finally {
      setAddMemberLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      await apiClient.delete(`/projects/${projectId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err: any) {
      alert(err.message || 'Failed to remove member');
    }
  };

  const handleToggleDeploymentProtection = async () => {
    if (!project) return;
    const newValue = !project.settings?.deploymentProtection;
    try {
      await apiClient.patch(`/projects/${projectId}`, {
        settings: { deploymentProtection: newValue },
      });
      setProject((prev: any) => ({
        ...prev,
        settings: { ...prev.settings, deploymentProtection: newValue },
      }));
    } catch (err: any) {
      alert(err.message || 'Failed to update project settings');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-3 text-neutral-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <span className="text-xs">Loading project details...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-sm text-red-400 font-medium text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Project Banner Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 pb-6 border-b border-white/5">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black text-white tracking-tight">{project?.name}</h1>
          </div>
          <p className="text-sm text-neutral-400 max-w-2xl font-light leading-relaxed">
            {project?.description || 'No description provided for this project.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
            // Default to production env when opening trigger modal
            const prodEnv = environments.find((e) => e.type === 'production');
            setDeployEnvId(prodEnv?.id || selectedEnvId || '');
            setShowTriggerDeployModal(true);
          }}
            className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-500/25"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Trigger Build
          </button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-white/5 gap-6 text-sm font-semibold">
        {[
          { id: 'envs', name: 'Environments & Secrets', icon: Layers },
          { id: 'deployments', name: 'Build History', icon: History },
          { id: 'members', name: 'Access Control', icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={clsx(
                'flex items-center gap-2 py-3 border-b-2 px-1 transition-all',
                activeTab === tab.id
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              )}
            >
              <Icon className="w-4.5 h-4.5" />
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* Tab Content: ENVIRONMENTS & SECRETS */}
      {activeTab === 'envs' && (
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Environment:</label>
              <div className="flex gap-2">
                {environments.map((env) => (
                  <button
                    key={env.id}
                    onClick={() => setSelectedEnvId(env.id)}
                    className={clsx(
                      'px-3.5 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider border transition-all',
                      selectedEnvId === env.id
                        ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400'
                        : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
                    )}
                  >
                    {env.name}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowAddSecretModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 hover:bg-white/5 rounded-xl text-xs font-semibold transition-all text-indigo-400"
            >
              <Plus className="w-4 h-4" />
              Add Secret
            </button>
          </div>

          {/* Secrets Table */}
          {secretsLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs">Loading secrets...</span>
            </div>
          ) : secrets.length === 0 ? (
            <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
              <Lock className="w-10 h-10 text-indigo-400/40 mx-auto" />
              <h3 className="text-base font-bold text-white">No Encrypted Secrets Found</h3>
              <p className="text-xs text-neutral-400 leading-relaxed font-light">
                There are no configuration secrets set up for this environment. Add variables to inject them securely into deployment runtimes.
              </p>
            </div>
          ) : (
            <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-white/[0.02] border-b border-white/5 text-neutral-400 font-bold uppercase tracking-wider">
                    <th className="px-6 py-4">Key</th>
                    <th className="px-6 py-4">Value</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-neutral-300 font-medium">
                  {secrets.map((secret) => (
                    <tr key={secret.id} className="hover:bg-white/[0.01] transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-white select-all">
                        {secret.key}
                      </td>
                      <td className="px-6 py-4 font-mono">
                        {revealedSecrets[secret.id] ? (
                          <span className="text-emerald-400 break-all select-all">
                            {revealedSecrets[secret.id]}
                          </span>
                        ) : (
                          <span className="text-neutral-600 tracking-widest select-none">
                            ••••••••••••
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-neutral-400 font-light max-w-xs truncate">
                        {secret.description || '—'}
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => handleRevealSecret(secret.id)}
                          className="p-1.5 bg-white/5 border border-white/5 hover:bg-white/10 text-neutral-400 hover:text-white rounded-lg transition-colors"
                          title={revealedSecrets[secret.id] ? 'Hide secret' : 'Reveal secret'}
                        >
                          {revealedSecrets[secret.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleOpenEditSecret(secret)}
                          className="p-1.5 bg-white/5 border border-white/5 hover:bg-white/10 text-neutral-400 hover:text-white rounded-lg transition-colors"
                          title="Edit secret value"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenVersions(secret)}
                          className="p-1.5 bg-white/5 border border-white/5 hover:bg-white/10 text-neutral-400 hover:text-white rounded-lg transition-colors text-xs font-semibold"
                          title="Version history"
                        >
                          History
                        </button>
                        <button
                          onClick={() => handleDeleteSecret(secret.id)}
                          className="p-1.5 bg-red-500/10 border border-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                          title="Delete secret"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Project Settings — Deployment Protection Toggle */}
          <div className="mt-6 p-5 glass-card rounded-2xl border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400" />
                  Production Deployment Protection
                </h4>
                <p className="text-xs text-neutral-400 font-light leading-relaxed">
                  When enabled, any deployment targeting a <span className="text-amber-400 font-semibold">protected environment</span> (e.g. Production) will be held in <code className="text-amber-300 bg-amber-500/10 px-1 rounded">pending_approval</code> status until an Admin manually approves or rejects it.
                </p>
              </div>
              <button
                onClick={handleToggleDeploymentProtection}
                className={clsx(
                  'relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none',
                  project?.settings?.deploymentProtection
                    ? 'bg-amber-500'
                    : 'bg-white/10'
                )}
                title={project?.settings?.deploymentProtection ? 'Disable deployment protection' : 'Enable deployment protection'}
              >
                <span
                  className={clsx(
                    'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
                    project?.settings?.deploymentProtection ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
            {project?.settings?.deploymentProtection && (
              <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Deployment protection is <strong>active</strong>. Builds to Production will require manual approval.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: BUILD HISTORY */}
      {activeTab === 'deployments' && (
        <div className="space-y-6">
          {deploymentsLoading && deployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs">Loading builds...</span>
            </div>
          ) : deployments.length === 0 ? (
            <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
              <Activity className="w-10 h-10 text-indigo-400/40 mx-auto" />
              <h3 className="text-base font-bold text-white">No Builds Triggered</h3>
              <p className="text-xs text-neutral-400 leading-relaxed font-light">
                No deployment builds have run for this project yet. Trigger a build from the top right to start.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {deployments.map((deploy) => (
                <div
                  key={deploy.id}
                  className="glass-card p-5 rounded-2xl border border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-grow min-w-0">
                    <div
                      className={clsx(
                        'w-3 h-3 rounded-full flex-shrink-0',
                        deploy.status === 'SUCCESS' && 'bg-emerald-500 shadow-md shadow-emerald-500/20',
                        deploy.status === 'FAILED' && 'bg-red-500 shadow-md shadow-red-500/20',
                        deploy.status === 'RUNNING' && 'bg-indigo-500 animate-pulse',
                        deploy.status === 'QUEUED' && 'bg-amber-500 animate-pulse',
                        (deploy.status === 'PENDING_APPROVAL' || deploy.status === 'pending_approval') && 'bg-amber-400 shadow-md shadow-amber-400/30'
                      )}
                    ></div>

                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm text-white">
                          #{deploy.id.slice(-6).toUpperCase()}
                        </span>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-white/5 border border-white/5 text-neutral-400 rounded-md">
                          {deploy.environmentName}
                        </span>
                        <span className="text-xs text-neutral-500 font-mono flex items-center gap-1">
                          <GitBranch className="w-3.5 h-3.5" />
                          {deploy.branch}
                        </span>
                        {(deploy.status === 'PENDING_APPROVAL' || deploy.status === 'pending_approval') && (
                          <span className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-md">
                            <Lock className="w-2.5 h-2.5" />
                            Awaiting Approval
                          </span>
                        )}
                      </div>

                      {deploy.commitMessage && (
                        <p className="text-xs text-neutral-300 truncate font-light">
                          {deploy.commitMessage}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-[10px] text-neutral-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(deploy.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span>•</span>
                        <span>By {deploy.triggeredBy.name}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                    <Link
                      to={`/projects/${projectId}/deployments/${deploy.id}`}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-bold transition-colors flex items-center gap-1"
                    >
                      Terminal Logs
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: ACCESS CONTROL MEMBERS */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-extrabold text-lg text-white">Project Membership</h3>
            <button
              onClick={() => setShowAddMemberModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 hover:bg-white/5 rounded-xl text-xs font-semibold transition-all text-indigo-400"
            >
              <Plus className="w-4 h-4" />
              Add Member
            </button>
          </div>

          {membersLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-xs">Loading members...</span>
            </div>
          ) : (
            <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-white/[0.02] border-b border-white/5 text-neutral-400 font-bold uppercase tracking-wider">
                    <th className="px-6 py-4">Name</th>
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4">Role</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-neutral-300 font-medium">
                  {members.map((member) => (
                    <tr key={member.userId} className="hover:bg-white/[0.01] transition-colors">
                      <td className="px-6 py-4 font-bold text-white">
                        {member.name}
                      </td>
                      <td className="px-6 py-4 text-neutral-400 font-light">
                        {member.email}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20">
                          {member.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleRemoveMember(member.userId)}
                          className="p-1.5 bg-red-500/10 border border-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                          title="Remove member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: ADD SECRET */}
      {showAddSecretModal && createPortal(
        <>
          <div onClick={() => setShowAddSecretModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">Add Encrypted Secret</h3>
              <p className="text-xs text-neutral-400">Stores AES-256-GCM encrypted variables.</p>
            </div>

            <form onSubmit={handleAddSecret} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Secret Key</label>
                <input
                  type="text"
                  required
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  placeholder="DATABASE_URL"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Secret Value</label>
                <input
                  type="password"
                  required
                  value={newSecretVal}
                  onChange={(e) => setNewSecretVal(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Description (Optional)</label>
                <input
                  type="text"
                  value={newSecretDesc}
                  onChange={(e) => setNewSecretDesc(e.target.value)}
                  placeholder="Database connection endpoint"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSecretModal(false)}
                  className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={secretActionLoading || !newSecretKey.trim() || !newSecretVal.trim()}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {secretActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Secret'}
                </button>
              </div>
            </form>
          </div>
        </>,
        document.body
      )}

      {/* Modal: UPDATE SECRET VALUE */}
      {showEditSecretModal && editingSecret && createPortal(
        <>
          <div onClick={() => { setShowEditSecretModal(false); setEditingSecret(null); }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">Update Secret: {editingSecret.key}</h3>
              <p className="text-xs text-neutral-400">Creates a new version of the encrypted variable.</p>
            </div>

            <form onSubmit={handleEditSecretSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">New Secret Value</label>
                <input
                  type="password"
                  required
                  value={editSecretVal}
                  onChange={(e) => setEditSecretVal(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
                <button
                  type="button"
                  onClick={() => { setShowEditSecretModal(false); setEditingSecret(null); }}
                  className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={secretActionLoading || !editSecretVal.trim()}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {secretActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update Value'}
                </button>
              </div>
            </form>
          </div>
        </>,
        document.body
      )}

      {/* Modal: SECRET VERSIONS HISTORY */}
      {showVersionsModal && createPortal(
        <>
          <div onClick={() => setShowVersionsModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">
                Version History: {selectedSecretForVersions?.key}
              </h3>
              <p className="text-xs text-neutral-400">View past secret updates and trigger rollbacks.</p>
            </div>

            {versionsLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-neutral-500">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                <span className="text-xs">Loading versions...</span>
              </div>
            ) : secretVersions.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-500">
                No versions found.
              </div>
            ) : (
              <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
                {secretVersions.map((version) => (
                  <div
                    key={version.id}
                    className="p-4 rounded-xl border border-white/5 bg-white/[0.01] flex items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white">Version {version.version}</span>
                        <span className="text-[10px] text-neutral-500">
                          {new Date(version.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[10px] text-neutral-400 mt-1">
                        Updated by {version.createdBy?.name || 'Unknown'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRollback(version)}
                      className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500 hover:text-white border border-indigo-500/20 text-indigo-400 font-bold rounded-lg transition-all"
                    >
                      Rollback
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowVersionsModal(false)}
                className="px-4 py-2.5 bg-white/5 border border-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Modal: TRIGGER DEPLOYMENT BUILD */}
      {showTriggerDeployModal && createPortal(
        <>
          <div onClick={() => { setShowTriggerDeployModal(false); setDeployEnvId(''); }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">Trigger Pipeline Build</h3>
              <p className="text-xs text-neutral-400">
                Run simulated build job in <span className="text-indigo-400 font-semibold">{selectedEnv?.name.toUpperCase()}</span>.
              </p>
            </div>

            <form onSubmit={handleTriggerDeployment} className="space-y-5">
              {/* Environment Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Target Environment</label>
                <select
                  value={deployEnvId}
                  onChange={(e) => setDeployEnvId(e.target.value)}
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name.charAt(0).toUpperCase() + env.name.slice(1)}{env.isProtected ? ' 🔒' : ''}
                    </option>
                  ))}
                </select>
                {environments.find((e) => e.id === deployEnvId)?.isProtected && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs font-medium">
                    <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Protected environment — deployment will be held for <strong>manual approval</strong> before running.</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Git Branch</label>
                <input
                  type="text"
                  required
                  value={deployBranch}
                  onChange={(e) => setDeployBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Commit Message (Optional)</label>
                <input
                  type="text"
                  value={deployCommitMsg}
                  onChange={(e) => setDeployCommitMsg(e.target.value)}
                  placeholder="Initial landing page design"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Commit Hash (Optional)</label>
                <input
                  type="text"
                  value={deployCommitHash}
                  onChange={(e) => setDeployCommitHash(e.target.value)}
                  placeholder="e.g. 7f9a12c"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
                <button
                  type="button"
                  onClick={() => { setShowTriggerDeployModal(false); setDeployEnvId(''); }}
                  className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={triggerLoading || !deployBranch.trim()}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {triggerLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Run Build'}
                </button>
              </div>
            </form>
          </div>
        </>,
        document.body
      )}

      {/* Modal: ADD MEMBER */}
      <Modal
        isOpen={showAddMemberModal}
        onClose={() => setShowAddMemberModal(false)}
        title="Add Project Member"
        description="Grant permissions to a team member on this project."
      >
        {addMemberError && (
          <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 animate-pulse" />
            <span className="font-medium">{addMemberError}</span>
          </div>
        )}

        <form onSubmit={handleAddMember} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">User Email</label>
            <input
              type="email"
              required
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="collaborator@company.com"
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Project Role</label>
            <select
              value={newMemberRole}
              onChange={(e) => setNewMemberRole(e.target.value as any)}
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors text-white"
            >
              <option value="viewer">Viewer (Read logs and secrets metadata)</option>
              <option value="developer">Developer (Add secrets and trigger builds)</option>
              <option value="admin">Admin (Manage access control and settings)</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
            <button
              type="button"
              onClick={() => setShowAddMemberModal(false)}
              className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addMemberLoading || !newMemberEmail.trim()}
              className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
            >
              {addMemberLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reusable Custom Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        description={confirmConfig.description}
        confirmText={confirmConfig.confirmText}
        cancelText={confirmConfig.cancelText}
        type={confirmConfig.type}
        isLoading={secretActionLoading}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => {
          if (confirmConfig.onCancel) {
            confirmConfig.onCancel();
          } else {
            setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
          }
        }}
      />
    </div>
  );
}
