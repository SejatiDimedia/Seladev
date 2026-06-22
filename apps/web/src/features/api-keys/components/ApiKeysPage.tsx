import { useState, useEffect, FormEvent } from 'react';
import { useOrgStore } from '../../../stores/org.store';
import { apiClient } from '../../../lib/api-client';
import { Key, Plus, Loader2, Copy, Check, Trash2, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ApiKey {
  id: string;
  name: string;
  description: string;
  prefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function ApiKeysPage() {
  const activeOrgId = useOrgStore((state) => state.activeOrgId);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scopes, setScopes] = useState<string[]>(['secrets:read']);
  const [expiryDays, setExpiryDays] = useState('30');

  // Response states
  const [createLoading, setCreateLoading] = useState(false);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/organizations/${activeOrgId}/api-keys`);
      setKeys(response.data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch API keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, [activeOrgId]);

  const handleCreateKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !activeOrgId) return;

    setCreateLoading(true);
    setError(null);

    // Calculate expiration date
    let expiresAt: string | null = null;
    if (expiryDays !== 'never') {
      const date = new Date();
      date.setDate(date.getDate() + parseInt(expiryDays));
      expiresAt = date.toISOString();
    }

    try {
      const response = await apiClient.post(`/organizations/${activeOrgId}/api-keys`, {
        name,
        description,
        scopes,
        expiresAt
      });

      const { apiKey, secretKey } = response.data.data;
      setKeys((prev) => [...prev, apiKey]);
      setCreatedRawKey(secretKey);

      // Reset inputs
      setName('');
      setDescription('');
      setScopes(['secrets:read']);
      setExpiryDays('30');
    } catch (err: any) {
      setError(err.message || 'Failed to create API key.');
      setShowCreateModal(false);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? Programmatic API access using this key will immediately fail.')) return;

    try {
      await apiClient.delete(`/api-keys/${keyId}`);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } catch (err: any) {
      alert(err.message || 'Failed to revoke API key.');
    }
  };

  const handleCopyKey = () => {
    if (createdRawKey) {
      navigator.clipboard.writeText(createdRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const availableScopes = [
    { value: 'secrets:read', label: 'Secrets Read (Allows retrieving masked secrets)' },
    { value: 'secrets:write', label: 'Secrets Write (Allows creating/updating secrets)' },
    { value: 'deployments:trigger', label: 'Deployments Trigger (Allows initiating new builds)' },
    { value: 'deployments:read', label: 'Deployments Read (Allows viewing build history)' },
    { value: 'webhooks:write', label: 'Webhooks Admin (Allows managing webhook subscriptions)' },
  ];

  const handleScopeToggle = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Key className="w-8 h-8 text-indigo-400" />
            API Keys
          </h1>
          <p className="text-sm text-neutral-400 leading-normal mt-1">
            Programmatic credentials for CI/CD runners and external scripts.
          </p>
        </div>

        <button
          onClick={() => {
            setCreatedRawKey(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4.5 h-4.5" />
          Generate Key
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      {/* API Keys Table */}
      {loading && keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <span className="text-xs">Loading API credentials...</span>
        </div>
      ) : keys.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
          <Key className="w-10 h-10 text-indigo-400/40 mx-auto" />
          <h3 className="text-base font-bold text-white">No API Keys Generated</h3>
          <p className="text-xs text-neutral-400 leading-relaxed font-light">
            You don't have any active API credentials. Generate an API key to configure deployments in GitHub Actions, GitLab CI, or custom CLI scripts.
          </p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/5 text-neutral-400 font-bold uppercase tracking-wider">
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Prefix / Key ID</th>
                <th className="px-6 py-4">Scopes</th>
                <th className="px-6 py-4">Expires</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-neutral-300 font-medium">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-white/[0.01] transition-colors">
                  <td className="px-6 py-4 font-bold text-white">
                    {key.name}
                    {key.description && (
                      <span className="block text-[10px] text-neutral-500 font-light mt-0.5 font-sans">
                        {key.description}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono select-all">
                    {key.prefix}...
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-[9px] font-bold px-1.5 py-0.5 bg-white/5 border border-white/5 text-neutral-400 rounded-md"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-light text-neutral-400">
                    {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDeleteKey(key.id)}
                      className="p-1.5 bg-red-500/10 border border-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                      title="Revoke key"
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

      {/* Generate API Key Modal */}
      {showCreateModal && !createdRawKey && createPortal(
        <>
          <div onClick={() => setShowCreateModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">Generate API Key</h3>
              <p className="text-xs text-neutral-400">Create programmatic token with scoped authorizations.</p>
            </div>

            <form onSubmit={handleCreateKey} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Key Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. GitHub Actions runner"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Description (Optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. CI/CD deployment runner token"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Scopes checklist */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Scopes</label>
                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {availableScopes.map((scope) => (
                    <label
                      key={scope.value}
                      className="flex items-center gap-2.5 p-2 bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope.value)}
                        onChange={() => handleScopeToggle(scope.value)}
                        className="rounded border-white/10 bg-neutral-900 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      <span className="text-xs text-neutral-300 select-none">{scope.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Expiry selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Expiration</label>
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors text-white"
                >
                  <option value="7">7 Days</option>
                  <option value="30">30 Days</option>
                  <option value="90">90 Days</option>
                  <option value="never">Never Expire (Not Recommended)</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading || !name.trim() || scopes.length === 0}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Generate'}
                </button>
              </div>
            </form>
          </div>
        </>, document.body
      )}

      {/* Raw Key Display Modal (Display once) */}
      {createdRawKey && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div className="flex items-center gap-2.5 text-amber-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-extrabold text-lg text-white">Save Your API Key</h3>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              Please copy your API key now. For security reasons, we cannot show this token again after you close this dialog.
            </p>

            <div className="bg-neutral-950 p-4 rounded-xl border border-white/5 flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-indigo-400 select-all break-all select-all font-bold">
                {createdRawKey}
              </span>
              <button
                onClick={handleCopyKey}
                className="p-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white rounded-lg transition-all flex-shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <button
              onClick={() => {
                setCreatedRawKey(null);
                setShowCreateModal(false);
              }}
              className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/5 text-white font-bold rounded-xl text-xs transition-colors"
            >
              I've copied the key safely
            </button>
          </div>
        </>
      )}
    </div>
  );
}
