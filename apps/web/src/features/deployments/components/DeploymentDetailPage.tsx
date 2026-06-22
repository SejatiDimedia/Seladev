import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../../../lib/api-client';
import { getSocket } from '../../../lib/socket';
import {
  Loader2,
  Terminal as TerminalIcon,
  Clock,
  GitBranch,
  ArrowLeft
} from 'lucide-react';
import clsx from 'clsx';

interface Deployment {
  id: string;
  projectId: string;
  environmentId: string;
  version: string;
  branch: string;
  commitSha?: string;
  commitMessage?: string;
  status: 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled' | 'pending_approval';
  triggeredVia: string;
  buildLogs: string[];
  duration?: number;
  createdAt: string;
  completedAt?: string;
}

export function DeploymentDetailPage() {
  const { projectId, deploymentId } = useParams<{ projectId: string; deploymentId: string }>();
  const navigate = useNavigate();
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDeployment = async () => {
    try {
      const response = await apiClient.get(`/projects/${projectId}/deployments/${deploymentId}`);
      const data = response.data.data;
      setDeployment(data);
      setLogs(data.buildLogs || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch deployment details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeployment();
  }, [projectId, deploymentId]);

  // Connect to Socket.IO and listen for log streaming
  useEffect(() => {
    const socket = getSocket();

    const handleLogLine = (data: { deploymentId: string; line: string }) => {
      if (data.deploymentId === deploymentId) {
        setLogs((prev) => [...prev, data.line]);
      }
    };

    const handleStatusChanged = (data: { deploymentId: string; status: Deployment['status'] }) => {
      if (data.deploymentId === deploymentId) {
        setDeployment((prev) => prev ? { ...prev, status: data.status } : null);
        // Refresh details on status change
        fetchDeployment();
      }
    };

    socket.on('deployment:log', handleLogLine);
    socket.on('deployment:status_changed', handleStatusChanged);

    return () => {
      socket.off('deployment:log', handleLogLine);
      socket.off('deployment:status_changed', handleStatusChanged);
    };
  }, [deploymentId]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this deployment?')) return;
    setActionLoading(true);
    try {
      await apiClient.post(`/projects/${projectId}/deployments/${deploymentId}/cancel`);
      fetchDeployment();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel deployment.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await apiClient.post(`/projects/${projectId}/deployments/${deploymentId}/approve`);
      fetchDeployment();
    } catch (err: any) {
      alert(err.message || 'Approval failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    setActionLoading(true);
    try {
      await apiClient.post(`/projects/${projectId}/deployments/${deploymentId}/reject`);
      fetchDeployment();
    } catch (err: any) {
      alert(err.message || 'Rejection failed.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-3 text-neutral-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <span className="text-xs">Loading build details...</span>
      </div>
    );
  }

  if (error || !deployment) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-sm text-red-400 font-medium text-center">
        {error || 'Deployment build not found.'}
      </div>
    );
  }

  const durationStr = deployment.duration
    ? `${Math.floor(deployment.duration / 1000)}s`
    : '—';

  return (
    <div className="space-y-8">
      {/* Back button & title */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="text-xs font-semibold text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors w-fit"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Project
        </button>
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              Build Run #{deployment.id.slice(-6).toUpperCase()}
            </h1>
            <p className="text-xs text-neutral-400">
              Triggered via <span className="font-semibold text-neutral-300">{deployment.triggeredVia.toUpperCase()}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {deployment.status === 'pending_approval' && (
              <div className="flex gap-2">
                <button
                  disabled={actionLoading}
                  onClick={handleApprove}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
                >
                  Approve Build
                </button>
                <button
                  disabled={actionLoading}
                  onClick={handleReject}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 font-bold rounded-lg text-xs transition-colors"
                >
                  Reject
                </button>
              </div>
            )}

            {(deployment.status === 'queued' || deployment.status === 'building' || deployment.status === 'deploying') && (
              <button
                disabled={actionLoading}
                onClick={handleCancel}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 font-bold rounded-lg text-xs transition-colors"
              >
                Cancel Pipeline
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Meta Grid info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 bg-white/[0.02] border border-white/5 p-6 rounded-2xl">
        <div className="space-y-1">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">Status</span>
          <span
            className={clsx(
              'text-xs font-bold uppercase tracking-wider flex items-center gap-1.5',
              deployment.status === 'success' && 'text-emerald-400',
              deployment.status === 'failed' && 'text-red-400',
              (deployment.status === 'building' || deployment.status === 'deploying' || deployment.status === 'queued') && 'text-indigo-400',
              deployment.status === 'cancelled' && 'text-neutral-500',
              deployment.status === 'pending_approval' && 'text-amber-400'
            )}
          >
            {deployment.status}
          </span>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">Branch</span>
          <span className="text-xs text-neutral-300 font-mono flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5" />
            {deployment.branch}
          </span>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">Duration</span>
          <span className="text-xs text-neutral-300 font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {durationStr}
          </span>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">Build Time</span>
          <span className="text-xs text-neutral-300">
            {new Date(deployment.createdAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Console Terminal Log Output */}
      <div className="space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="text-neutral-400 flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-indigo-400" />
            Pipeline Console Log Output
          </span>
          {deployment.status === 'building' && (
            <span className="flex items-center gap-1.5 text-indigo-400 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Streaming logs...
            </span>
          )}
        </div>

        <div className="bg-neutral-950 border border-white/5 rounded-2xl p-6 font-mono text-xs overflow-x-auto h-[480px] flex flex-col justify-between shadow-2xl relative">
          <div className="space-y-1.5 overflow-y-auto pr-2 max-h-[440px] scrollbar-thin">
            {logs.length === 0 ? (
              <span className="text-neutral-600 italic select-none">Waiting for build stream logs...</span>
            ) : (
              logs.map((line, idx) => (
                <div key={idx} className="text-neutral-300 select-all break-all leading-relaxed whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
