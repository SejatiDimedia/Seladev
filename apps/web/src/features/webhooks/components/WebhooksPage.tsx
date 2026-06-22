import { useState, useEffect, FormEvent } from 'react';
import { useOrgStore } from '../../../stores/org.store';
import { apiClient } from '../../../lib/api-client';
import {
  Radio,
  Plus,
  Loader2,
  Trash2,
  CheckCircle,
  XCircle,
  Play,
  X,
  Globe
} from 'lucide-react';
import clsx from 'clsx';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret: string;
  createdAt: string;
}

interface DeliveryLog {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, any>;
  statusCode: number | null;
  requestHeaders: Record<string, any>;
  responseBody: string | null;
  duration: number | null;
  error: string | null;
  attempt: number;
  status: 'success' | 'failed' | 'pending';
  createdAt: string;
}

export function WebhooksPage() {
  const activeOrgId = useOrgStore((state) => state.activeOrgId);

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['deployment.completed']);
  const [createLoading, setCreateLoading] = useState(false);
  
  // Revealed secrets state
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  // Delivery logs drawer state
  const [selectedWebhookForLogs, setSelectedWebhookForLogs] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryLog[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const fetchWebhooks = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/organizations/${activeOrgId}/webhooks`);
      setWebhooks(response.data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch webhooks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, [activeOrgId]);

  const handleCreateWebhook = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || !activeOrgId) return;

    setCreateLoading(true);
    try {
      const response = await apiClient.post(`/organizations/${activeOrgId}/webhooks`, {
        name,
        url,
        events
      });
      setWebhooks((prev) => [...prev, response.data.data]);
      setShowCreateModal(false);
      setName('');
      setUrl('');
      setEvents(['deployment.completed']);
    } catch (err: any) {
      alert(err.message || 'Failed to create webhook');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!confirm('Are you sure you want to delete this webhook destination?')) return;

    try {
      await apiClient.delete(`/organizations/${activeOrgId}/webhooks/${webhookId}`);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
    } catch (err: any) {
      alert(err.message || 'Failed to delete webhook.');
    }
  };

  const handleRotateSecret = async (webhookId: string) => {
    if (!confirm('Are you sure you want to rotate the signing secret? Immediate events signed using the old secret will fail validation at your server.')) return;

    try {
      const response = await apiClient.post(`/organizations/${activeOrgId}/webhooks/${webhookId}/rotate-secret`);
      setWebhooks((prev) =>
        prev.map((w) => (w.id === webhookId ? { ...w, secret: response.data.data.secret } : w))
      );
      alert('Secret rotated successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to rotate secret.');
    }
  };

  const handleTestWebhook = async (webhookId: string) => {
    try {
      await apiClient.post(`/organizations/${activeOrgId}/webhooks/${webhookId}/test`);
      alert('Test webhook ping sent to the background queue!');
      
      // If delivery log viewer is active for this webhook, reload log history
      if (selectedWebhookForLogs?.id === webhookId) {
        fetchDeliveries(webhookId);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to test webhook.');
    }
  };

  const fetchDeliveries = async (webhookId: string) => {
    setDeliveriesLoading(true);
    try {
      const response = await apiClient.get(`/organizations/${activeOrgId}/webhooks/${webhookId}/deliveries`);
      setDeliveries(response.data.data);
    } catch (err) {
      console.error('Failed to load deliveries', err);
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const handleOpenLogs = (webhook: Webhook) => {
    setSelectedWebhookForLogs(webhook);
    setDeliveries([]);
    fetchDeliveries(webhook.id);
  };

  const availableEvents = [
    { value: 'deployment.triggered', label: 'Deployment Triggered' },
    { value: 'deployment.completed', label: 'Deployment Completed' },
    { value: 'secret.created', label: 'Secret Created' },
    { value: 'secret.revealed', label: 'Secret Revealed' },
    { value: 'apikey.created', label: 'API Key Created' },
  ];

  const handleEventToggle = (eventVal: string) => {
    setEvents((prev) =>
      prev.includes(eventVal) ? prev.filter((e) => e !== eventVal) : [...prev, eventVal]
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Radio className="w-8 h-8 text-indigo-400" />
            Webhooks
          </h1>
          <p className="text-sm text-neutral-400 leading-normal mt-1">
            Dispatch HTTP POST payload notifications to external webhook urls.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4.5 h-4.5" />
          Add Webhook
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      {/* Webhooks list */}
      {loading && webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <span className="text-xs">Loading webhook targets...</span>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-4">
          <Globe className="w-10 h-10 text-indigo-400/40 mx-auto" />
          <h3 className="text-base font-bold text-white">No Webhooks Set Up</h3>
          <p className="text-xs text-neutral-400 leading-relaxed font-light">
            You don't have any webhook integrations. Add a target URL to subscribe to platform audit events.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="glass-card p-6 rounded-2xl border border-white/5 space-y-6 hover:border-white/10 transition-colors"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="space-y-1.5 flex-grow min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-bold text-base text-white">{webhook.name}</h3>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                      Active
                    </span>
                  </div>
                  <p className="text-xs font-mono text-indigo-400 break-all select-all font-semibold">
                    {webhook.url}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => handleTestWebhook(webhook.id)}
                    className="p-2 bg-white/5 border border-white/5 hover:bg-white/10 text-neutral-300 hover:text-white rounded-lg transition-colors flex items-center gap-1 text-xs font-bold"
                    title="Send Test Ping Payload"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Test
                  </button>
                  <button
                    onClick={() => handleOpenLogs(webhook)}
                    className="p-2 bg-white/5 border border-white/5 hover:bg-white/10 text-neutral-300 hover:text-white rounded-lg transition-colors text-xs font-bold"
                  >
                    Logs
                  </button>
                  <button
                    onClick={() => handleDeleteWebhook(webhook.id)}
                    className="p-2 bg-red-500/10 border border-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Event Subscriptions & Signing secret */}
              <div className="border-t border-white/5 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">Subscribed Events</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {webhook.events.map((ev) => (
                      <span
                        key={ev}
                        className="text-[9px] font-bold px-1.5 py-0.5 bg-white/5 border border-white/5 text-neutral-400 rounded-md"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold block">HMAC SHA256 Signing Secret</span>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="font-mono text-xs text-neutral-400 select-all font-bold">
                      {revealedSecrets[webhook.id] ? webhook.secret : '••••••••••••••••••••••••'}
                    </span>
                    <button
                      onClick={() => setRevealedSecrets((prev) => ({ ...prev, [webhook.id]: !prev[webhook.id] }))}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors font-bold"
                    >
                      {revealedSecrets[webhook.id] ? 'Hide' : 'Reveal'}
                    </button>
                    <span>•</span>
                    <button
                      onClick={() => handleRotateSecret(webhook.id)}
                      className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1 font-bold"
                    >
                      Rotate
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Webhook Modal */}
      {showCreateModal && (
        <>
          <div onClick={() => setShowCreateModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">Add Webhook Target</h3>
              <p className="text-xs text-neutral-400">Subscribe your server endpoint to platform events.</p>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Webhook Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Slack alert target"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Payload URL</label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yourdomain.com/webhooks"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Event Subscriptions checkmarks */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Trigger Events</label>
                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {availableEvents.map((ev) => (
                    <label
                      key={ev.value}
                      className="flex items-center gap-2.5 p-2 bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={events.includes(ev.value)}
                        onChange={() => handleEventToggle(ev.value)}
                        className="rounded border-white/10 bg-neutral-900 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      <span className="text-xs text-neutral-300 select-none">{ev.label}</span>
                    </label>
                  ))}
                </div>
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
                  disabled={createLoading || !name.trim() || !url.trim() || events.length === 0}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Webhook Delivery Logs Drawer */}
      {selectedWebhookForLogs && (
        <>
          <div onClick={() => setSelectedWebhookForLogs(null)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-[#09090b] border-l border-white/5 p-6 z-[10000] transition-transform duration-300 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="pb-4 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-extrabold text-base text-white">Delivery Logs</h3>
                  <p className="text-[10px] text-neutral-400">{selectedWebhookForLogs.name}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedWebhookForLogs(null)}
                className="p-1.5 hover:bg-white/5 rounded-lg text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Delivery Logs list */}
            <div className="flex-grow overflow-y-auto py-6 space-y-4">
              {deliveriesLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                  <span className="text-xs">Querying webhook queue...</span>
                </div>
              ) : deliveries.length === 0 ? (
                <div className="p-6 text-center text-xs text-neutral-500">
                  No delivery logs recorded for this webhook.
                </div>
              ) : (
                deliveries.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-white/5 bg-white/[0.01] space-y-3"
                  >
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-white font-mono">{log.event}</span>
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full',
                          log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        )}
                      >
                        {log.status === 'success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {log.statusCode ? `HTTP ${log.statusCode}` : log.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] text-neutral-500 font-mono">
                      <div>Attempt: #{log.attempt}</div>
                      <div className="text-right">
                        {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>

                    {log.error && (
                      <div className="p-2.5 bg-red-500/5 border border-red-500/10 text-red-400 text-[10px] rounded-lg font-mono break-all leading-normal">
                        Error: {log.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
