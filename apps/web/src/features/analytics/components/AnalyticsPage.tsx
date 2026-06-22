import { useState, useEffect } from 'react';
import { useOrgStore } from '../../../stores/org.store';
import { apiClient } from '../../../lib/api-client';
import {
  BarChart3,
  Loader2,
  Layers,
  Activity,
  Flame,
  CheckCircle,
  AlertTriangle,
  Radio,
  Clock,
  Key
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description: string;
}

interface DeploymentData {
  series: Array<{ period: string; total: number; succeeded: number; failed: number; cancelled: number }>;
  overall: { total: number; succeeded: number; failed: number; successRate: number; avgDuration: number };
}

interface WebhookData {
  series: Array<{ period: string; total: number; succeeded: number; failed: number }>;
  overall: { total: number; succeeded: number; failed: number; successRate: number };
}

export function AnalyticsPage() {
  const activeOrgId = useOrgStore((state) => state.activeOrgId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);

  // Stats data
  const [deployStats, setDeployStats] = useState<DeploymentData | null>(null);
  const [webhookStats, setWebhookStats] = useState<WebhookData | null>(null);
  const [apiKeyStats, setApiKeyStats] = useState<any>(null);
  const [secretStats, setSecretStats] = useState<any>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      if (!activeOrgId) return;
      setLoadingProjects(true);
      try {
        const response = await apiClient.get(`/organizations/${activeOrgId}/projects`);
        const data = response.data.data;
        setProjects(data);
        if (data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (err: any) {
        console.error('Failed to load projects', err);
      } finally {
        setLoadingProjects(false);
      }
    };

    fetchProjects();
  }, [activeOrgId]);

  const fetchAnalytics = async () => {
    if (!selectedProjectId) return;
    setLoadingStats(true);
    try {
      const [deployRes, webhookRes, apikeyRes, secretRes] = await Promise.all([
        apiClient.get(`/projects/${selectedProjectId}/analytics/deployments`, { params: { granularity: 'day' } }),
        apiClient.get(`/projects/${selectedProjectId}/analytics/webhooks`, { params: { granularity: 'day' } }),
        apiClient.get(`/projects/${selectedProjectId}/analytics/api-keys`, { params: { granularity: 'day' } }),
        apiClient.get(`/projects/${selectedProjectId}/analytics/secrets`)
      ]);

      setDeployStats(deployRes.data.data);
      setWebhookStats(webhookRes.data.data);
      setApiKeyStats(apikeyRes.data.data);
      setSecretStats(secretRes.data.data);
    } catch (err: any) {
      console.error('Failed to load stats', err);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [selectedProjectId]);

  if (loadingProjects) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-3 text-neutral-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <span className="text-xs">Loading analytics panel...</span>
      </div>
    );
  }

  // Render a responsive SVG Sparkline/Bar Chart
  const renderDeploymentChart = () => {
    if (!deployStats || deployStats.series.length === 0) {
      return (
        <div className="h-48 flex items-center justify-center text-xs text-neutral-500 italic">
          No deployment series history available for this period.
        </div>
      );
    }

    const series = deployStats.series;
    const maxVal = Math.max(...series.map((s) => s.total), 5);
    const width = 500;
    const height = 180;
    const padding = 20;

    const points = series.map((s, index) => {
      const x = padding + (index / (series.length - 1 || 1)) * (width - padding * 2);
      const y = height - padding - (s.total / maxVal) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <div className="relative pt-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
          {/* Grid lines */}
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          
          {/* Trend Line */}
          <polyline
            fill="none"
            stroke="url(#indigo-grad)"
            strokeWidth={3}
            points={points}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Sparkles glow under path */}
          <defs>
            <linearGradient id="indigo-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>
        </svg>

        {/* X-axis labels */}
        <div className="flex justify-between text-[9px] text-neutral-500 px-2 mt-2 font-mono">
          <span>{series[0]?.period}</span>
          <span>{series[Math.floor(series.length / 2)]?.period}</span>
          <span>{series[series.length - 1]?.period}</span>
        </div>
      </div>
    );
  };

  const successRate = deployStats?.overall?.successRate !== undefined 
    ? Math.round(deployStats.overall.successRate * 100) 
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-indigo-400" />
            Analytics
          </h1>
          <p className="text-sm text-neutral-400 leading-normal mt-1">
            Observe deployment velocity and platform API performance.
          </p>
        </div>

        {projects.length > 0 && (
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-neutral-400 font-semibold">Scope:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="px-4 py-2 bg-neutral-900 border border-white/10 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
            >
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
          <Layers className="w-10 h-10 text-indigo-400/40 mx-auto" />
          <h3 className="text-base font-bold text-white">No Projects Found</h3>
          <p className="text-xs text-neutral-400 leading-relaxed font-light">
            Create a project first to monitor deployment velocity, API calls, and webhook deliveries.
          </p>
        </div>
      ) : loadingStats ? (
        <div className="flex flex-col items-center justify-center py-40 gap-3 text-neutral-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <span className="text-xs">Aggregating platform metrics...</span>
        </div>
      ) : (
        <div className="space-y-8">
          {/* DORA Metrics Spark Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-card p-5 rounded-2xl border border-white/5 space-y-4">
              <div className="flex justify-between items-center text-xs text-neutral-500">
                <span>Deployment Frequency</span>
                <Activity className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="space-y-0.5">
                <span className="text-2xl font-black text-white">
                  {deployStats?.overall?.total || 0}
                </span>
                <p className="text-[10px] text-neutral-400 font-light">Total builds triggered</p>
              </div>
            </div>

            <div className="glass-card p-5 rounded-2xl border border-white/5 space-y-4">
              <div className="flex justify-between items-center text-xs text-neutral-500">
                <span>Change Failure Rate</span>
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <div className="space-y-0.5">
                <span className="text-2xl font-black text-white">
                  {100 - successRate}%
                </span>
                <p className="text-[10px] text-neutral-400 font-light">Build failure percentage</p>
              </div>
            </div>

            <div className="glass-card p-5 rounded-2xl border border-white/5 space-y-4">
              <div className="flex justify-between items-center text-xs text-neutral-500">
                <span>Success Rate</span>
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="space-y-0.5">
                <span className="text-2xl font-black text-white">
                  {successRate}%
                </span>
                <p className="text-[10px] text-neutral-400 font-light">Pipeline run completion</p>
              </div>
            </div>

            <div className="glass-card p-5 rounded-2xl border border-white/5 space-y-4">
              <div className="flex justify-between items-center text-xs text-neutral-500">
                <span>Mean Execution Duration</span>
                <Clock className="w-4 h-4 text-purple-400" />
              </div>
              <div className="space-y-0.5">
                <span className="text-2xl font-black text-white">
                  {deployStats?.overall?.avgDuration
                    ? `${Math.round(deployStats.overall.avgDuration / 1000)}s`
                    : '—'}
                </span>
                <p className="text-[10px] text-neutral-400 font-light">Average pipeline build speed</p>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Deployments Chart */}
            <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-extrabold text-sm text-white">Deployment Trends</h3>
                <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wide">Daily Frequency</span>
              </div>
              {renderDeploymentChart()}
            </div>

            {/* API Keys statistics */}
            <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-6">
              <h3 className="font-extrabold text-sm text-white">Security & Audits</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-white/[0.01] border border-white/5 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-white">Programmatic API Hits</h4>
                      <p className="text-[10px] text-neutral-500 font-light mt-0.5">API key requests processed</p>
                    </div>
                  </div>
                  <span className="text-lg font-black text-white">
                    {apiKeyStats?.overall?.totalUsage || 0}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/[0.01] border border-white/5 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-xl text-purple-400">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-white">Webhook Dispatches</h4>
                      <p className="text-[10px] text-neutral-500 font-light mt-0.5">Dispatched event webhooks</p>
                    </div>
                  </div>
                  <span className="text-lg font-black text-white">
                    {webhookStats?.overall?.total || 0}
                  </span>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/[0.01] border border-white/5 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-white">Secret Reveal Actions</h4>
                      <p className="text-[10px] text-neutral-500 font-light mt-0.5">Environment secret reads</p>
                    </div>
                  </div>
                  <span className="text-lg font-black text-white">
                    {secretStats?.overall?.totalReveals || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
