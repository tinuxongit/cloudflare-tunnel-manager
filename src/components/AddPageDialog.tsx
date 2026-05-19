import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import type { Tunnel } from '@/lib/types';
import { useStore } from '@/lib/store';

type Props = { open: boolean; onClose: () => void };

export function AddPageDialog({ open, onClose }: Props) {
  const { tunnels, refreshPages, refreshTunnels } = useStore();
  const [hostname, setHostname] = useState('');
  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [tunnelUuid, setTunnelUuid] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      refreshTunnels();
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!tunnelUuid && tunnels[0]) setTunnelUuid(tunnels[0].uuid);
  }, [tunnels, tunnelUuid]);

  if (!open) return null;

  async function submit() {
    setSubmitting(true); setError(null);
    try {
      const page = await api.createPage({ hostname, service_url: serviceUrl, tunnel_uuid: tunnelUuid });
      await api.routeDns(tunnelUuid, hostname);
      await refreshPages();
      onClose();
      setHostname(''); setServiceUrl('http://localhost:3000');
      void page;
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] bg-bg-elev border border-border-strong rounded-xl p-6 shadow-2xl">
        <h3 className="text-base font-semibold mb-4">Add page</h3>
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
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-40">
            {submitting ? 'Adding…' : 'Add page'}
          </button>
        </div>
      </div>
    </div>
  );
}
