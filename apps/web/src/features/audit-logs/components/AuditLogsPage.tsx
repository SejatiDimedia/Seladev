import { useState, useEffect } from 'react';
import { useOrgStore } from '../../../stores/org.store';
import { apiClient } from '../../../lib/api-client';
import {
  ShieldAlert,
  Loader2,
  Filter,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import clsx from 'clsx';

interface AuditLog {
  id: string;
  organizationId: string;
  projectId?: string;
  actor: {
    userId: string | null;
    email?: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    name: string;
  };
  outcome: 'success' | 'failure';
  metadata: Record<string, any>;
  createdAt: string;
}

export function AuditLogsPage() {
  const activeOrgId = useOrgStore((state) => state.activeOrgId);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination states
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);

  // Filter states
  const [actorEmail, setActorEmail] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [outcome, setOutcome] = useState('');

  const fetchLogs = async (cursor: string | null = null, append = false) => {
    if (!activeOrgId) return;
    if (!append) setLoading(true);
    
    setError(null);
    try {
      const params: Record<string, any> = {
        limit: 15,
        cursor: cursor || undefined,
        actorEmail: actorEmail.trim() || undefined,
        action: action.trim() || undefined,
        resourceType: resourceType || undefined,
        outcome: outcome || undefined,
      };

      const response = await apiClient.get(`/organizations/${activeOrgId}/audit-logs`, { params });
      const data = response.data.data;
      const pagination = response.data.pagination;

      setLogs((prev) => (append ? [...prev, ...data] : data));
      setNextCursor(pagination.nextCursor);
      setHasNext(pagination.hasNext);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [activeOrgId]);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleClearFilters = () => {
    setActorEmail('');
    setAction('');
    setResourceType('');
    setOutcome('');
    // We cannot wait for state set since it's async, we fetch logs with clear values directly
    setTimeout(() => {
      apiClient.get(`/organizations/${activeOrgId}/audit-logs`, { params: { limit: 15 } })
        .then((res) => {
          setLogs(res.data.data);
          setNextCursor(res.data.pagination.nextCursor);
          setHasNext(res.data.pagination.hasNext);
        })
        .catch(() => {});
    }, 50);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 text-indigo-400" />
          Audit Logs
        </h1>
        <p className="text-sm text-neutral-400 leading-normal mt-1">
          Immutable platform history and system audit trials trail logs.
        </p>
      </div>

      {/* Filter panel */}
      <form onSubmit={handleApplyFilters} className="glass-card p-5 rounded-2xl border border-white/5 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          <Filter className="w-4 h-4 text-indigo-400" />
          Filter Logs
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Actor Email</label>
            <input
              type="text"
              value={actorEmail}
              onChange={(e) => setActorEmail(e.target.value)}
              placeholder="e.g. admin@company.com"
              className="w-full px-3.5 py-2 bg-neutral-900 border border-white/5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Action Type</label>
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. secret.revealed"
              className="w-full px-3.5 py-2 bg-neutral-900 border border-white/5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Resource Type</label>
            <select
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              className="w-full px-3.5 py-2 bg-neutral-900 border border-white/5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 transition-colors text-white"
            >
              <option value="">All Resources</option>
              <option value="project">Project</option>
              <option value="secret">Secret</option>
              <option value="api-key">API Key</option>
              <option value="deployment">Deployment</option>
              <option value="organization">Organization</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full px-3.5 py-2 bg-neutral-900 border border-white/5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 transition-colors text-white"
            >
              <option value="">All Outcomes</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
          <button
            type="button"
            onClick={handleClearFilters}
            className="px-4 py-2 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
          >
            Clear Filters
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors flex items-center gap-1.5"
          >
            Apply Filters
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      {/* Logs Table */}
      {loading && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <span className="text-xs">Querying audit trail...</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
          <ShieldAlert className="w-10 h-10 text-indigo-400/40 mx-auto" />
          <h3 className="text-base font-bold text-white">No Audit Entries Found</h3>
          <p className="text-xs text-neutral-400 leading-relaxed font-light">
            No events match your current filter settings. Try relaxing your filters.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/5 text-neutral-400 font-bold uppercase tracking-wider">
                  <th className="px-6 py-4">Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Resource</th>
                  <th className="px-6 py-4">Outcome</th>
                  <th className="px-6 py-4">IP Address</th>
                  <th className="px-6 py-4">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-neutral-300 font-medium">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-6 py-4 font-bold text-white">
                      {log.actor.email || 'system-worker'}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-neutral-300">
                      {log.action}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-white">{log.resource.name}</span>
                      <span className="block text-[10px] text-neutral-500 font-light mt-0.5">
                        Type: {log.resource.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 font-bold uppercase text-[9px] tracking-wider px-2 py-0.5 rounded-full',
                          log.outcome === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        )}
                      >
                        {log.outcome === 'success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {log.outcome}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-neutral-400 font-light">
                      {log.actor.ipAddress || '—'}
                    </td>
                    <td className="px-6 py-4 text-neutral-400 font-light font-mono text-[10px]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasNext && (
            <div className="flex justify-center">
              <button
                onClick={() => fetchLogs(nextCursor, true)}
                className="px-6 py-3 bg-white/5 border border-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2"
              >
                Load More Logs
                <Clock className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
