import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import type { Page, Tunnel } from '@/lib/types';
import { useStore } from '@/lib/store';

type Props = {
  open: boolean;
  onClose: () => void;
  editing?: Page | null;
};

export function AddPageDialog({ open, onClose, editing }: Props) {
  const { tunnels, refreshPages, refreshTunnels } = useStore();
  const [hostname, setHostname] = useState('');
  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [tunnelUuid, setTunnelUuid] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = !!editing;

  useEffect(() => {
    if (open) {
      refreshTunnels();
      setError(null);
      if (editing) {
        setHostname(editing.hostname);
        setServiceUrl(editing.service_url);
        setTunnelUuid(editing.tunnel_uuid);
      } else {
        setHostname('');
        setServiceUrl('http://localhost:3000');
      }
    }
  }, [open, editing]);

  useEffect(() => {
    if (!tunnelUuid && tunnels[0] && !editing) setTunnelUuid(tunnels[0].uuid);
  }, [tunnels, tunnelUuid, editing]);

  if (!open) return null;

  async function submit() {
    setSubmitting(true); setError(null);
    try {
      if (isEdit && editing) {
        // Update existing page. If hostname or tunnel changed, run route_dns for new combo.
        const hostnameChanged = editing.hostname !== hostname;
        const tunnelChanged = editing.tunnel_uuid !== tunnelUuid;
        if (hostnameChanged || tunnelChanged) {
          await api.routeDns(tunnelUuid, hostname);
        }
        await api.updatePage(editing.id, {
          hostname, service_url: serviceUrl, tunnel_uuid: tunnelUuid,
        });
        await api.startOrRestartForPage(editing.id);
      } else {
        await api.routeDns(tunnelUuid, hostname);
        await api.createPage({ hostname, service_url: serviceUrl, tunnel_uuid: tunnelUuid });
      }
      await refreshPages();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] bg-bg-elev border border-border-strong rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-4">{isEdit ? 'Edit page' : 'Add page'}</h3>
        <label className="block text-xs font-mono text-fg-dim mb-1">Hostname</label>
        <input value={hostname} onChange={e => setHostname(e.target.value)}
          placeholder="example.com"
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-3 font-mono" />

        <label className="block text-xs font-mono text-fg-dim mb-1">Local service URL</label>
        <input value={serviceUrl} onChange={e => setServiceUrl(e.target.value)}
          placeholder="http://localhost:3000"
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-3 font-mono" />

        <label className="block text-xs font-mono text-fg-dim mb-1">Tunnel</label>
        <select value={tunnelUuid} onChange={e => setTunnelUuid(e.target.value)}
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-4 font-mono">
          {tunnels.map((t: Tunnel) => <option key={t.uuid} value={t.uuid}>{t.name} ({t.uuid.slice(0, 8)})</option>)}
        </select>

        {error && <div className="text-red-400 text-xs mb-3">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-fg-muted hover:text-fg">Cancel</button>
          <button onClick={submit} disabled={!hostname || !tunnelUuid || submitting}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-40 flex items-center gap-2">
            {submitting && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
            {submitting ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save' : 'Add page')}
          </button>
        </div>
      </div>
    </div>
  );
}
