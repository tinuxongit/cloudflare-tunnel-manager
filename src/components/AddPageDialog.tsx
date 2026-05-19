import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/ipc';
import type { Page, Tunnel } from '@/lib/types';
import { useStore } from '@/lib/store';

type Props = {
  open: boolean;
  onClose: () => void;
  editing?: Page | null;
};

export function AddPageDialog({ open, onClose, editing }: Props) {
  const { tunnels, zones, hasToken, refreshPages, refreshTunnels, refreshZones, refreshTokenState } = useStore();

  // Free-text fallback when no token / no zones loaded
  const [hostnameRaw, setHostnameRaw] = useState('');

  // Zone-aware form
  const [subdomain, setSubdomain] = useState('');
  const [zoneName, setZoneName] = useState('');

  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [tunnelUuid, setTunnelUuid] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [conflictRetry, setConflictRetry] = useState(false); // shows "Overwrite" button

  const isEdit = !!editing;
  const useZoneMode = hasToken && zones.length > 0;

  const finalHostname = useMemo(() => {
    if (!useZoneMode) return hostnameRaw.trim();
    const sub = subdomain.trim().replace(/\.+$/, '');
    return sub ? `${sub}.${zoneName}` : zoneName;
  }, [useZoneMode, hostnameRaw, subdomain, zoneName]);

  // Reset / preload when dialog opens
  useEffect(() => {
    if (!open) return;
    refreshTunnels();
    // Re-check token state every open in case it was just added in Settings,
    // then load zones if we have a token. refreshZones is best-effort (catches
    // internally and sets [] on failure).
    (async () => {
      await refreshTokenState();
      if (useStore.getState().hasToken) await refreshZones();
    })();
    setError(null);

    if (editing) {
      setHostnameRaw(editing.hostname);
      setServiceUrl(editing.service_url);
      setTunnelUuid(editing.tunnel_uuid);
      // Try to split hostname into subdomain + zone if a zone matches
      const z = zones.find(z =>
        editing.hostname === z.name || editing.hostname.endsWith('.' + z.name)
      );
      if (z) {
        setZoneName(z.name);
        const sub = editing.hostname === z.name
          ? ''
          : editing.hostname.slice(0, editing.hostname.length - z.name.length - 1);
        setSubdomain(sub);
      } else {
        setZoneName('');
        setSubdomain('');
      }
    } else {
      setHostnameRaw('');
      setServiceUrl('http://localhost:3000');
      setSubdomain('');
      setZoneName('');
    }
  }, [open, editing, hasToken]);

  useEffect(() => {
    if (!tunnelUuid && tunnels[0] && !editing) setTunnelUuid(tunnels[0].uuid);
  }, [tunnels, tunnelUuid, editing]);

  useEffect(() => {
    if (useZoneMode && !zoneName && zones[0]) setZoneName(zones[0].name);
  }, [useZoneMode, zoneName, zones]);

  if (!open) return null;

  // Helper: route DNS via the explicit-zone API path when we have a zone selected
  // (avoids cloudflared's zone-guessing bug). Fall back to the CLI path otherwise.
  async function doRouteDns(hostname: string, overwrite: boolean) {
    if (useZoneMode && zoneName) {
      const zone = zones.find(z => z.name === zoneName);
      if (zone) {
        await api.routeDnsViaApi(zone.id, hostname, tunnelUuid, overwrite);
        return;
      }
    }
    await api.routeDns(tunnelUuid, hostname, overwrite);
  }

  async function submit(overwrite = false) {
    setSubmitting(true); setError(null); setConflictRetry(false);
    try {
      if (!finalHostname) {
        setError('Hostname is empty.');
        setSubmitting(false);
        return;
      }
      if (isEdit && editing) {
        const hostnameChanged = editing.hostname !== finalHostname;
        const tunnelChanged = editing.tunnel_uuid !== tunnelUuid;
        if (hostnameChanged || tunnelChanged) {
          await doRouteDns(finalHostname, overwrite);
        }
        await api.updatePage(editing.id, {
          hostname: finalHostname, service_url: serviceUrl, tunnel_uuid: tunnelUuid,
        });
        await api.startOrRestartForPage(editing.id);
      } else {
        await doRouteDns(finalHostname, overwrite);
        await api.createPage({ hostname: finalHostname, service_url: serviceUrl, tunnel_uuid: tunnelUuid });
      }
      await refreshPages();
      onClose();
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      setError(msg);
      // Detect record-conflict variants from both CLI (code: 1003) and API (81053 / "already exists").
      if (!overwrite && /code:\s*1003|81053|81057|already exists|identical record/i.test(msg)) {
        setConflictRetry(true);
      }
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[520px] bg-bg-elev border border-border-strong rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-4">{isEdit ? 'Edit page' : 'Add page'}</h3>

        <label className="block text-xs font-mono text-fg-dim mb-1">Hostname</label>
        {useZoneMode ? (
          <div className="flex gap-2 mb-1">
            <input
              value={subdomain}
              onChange={e => setSubdomain(e.target.value)}
              placeholder="subdomain (optional)"
              className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono" />
            <span className="self-center text-fg-faint font-mono">.</span>
            <select
              value={zoneName}
              onChange={e => setZoneName(e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono min-w-[180px]">
              {zones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
            </select>
          </div>
        ) : (
          <input
            value={hostnameRaw}
            onChange={e => setHostnameRaw(e.target.value)}
            placeholder="example.com"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-1 font-mono" />
        )}
        <div className="text-[10px] text-fg-faint font-mono mb-3">
          → {finalHostname || '(empty)'}
          {!hasToken && (
            <span className="ml-2">· Add a Cloudflare API token in Settings to get a zone dropdown.</span>
          )}
          {hasToken && zones.length === 0 && (
            <span className="ml-2 text-yellow-400">· Token set but no zones loaded — check Settings → Cloudflare access.</span>
          )}
        </div>

        <label className="block text-xs font-mono text-fg-dim mb-1">Local service URL</label>
        <input value={serviceUrl} onChange={e => setServiceUrl(e.target.value)}
          placeholder="http://localhost:3000"
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-3 font-mono" />

        <label className="block text-xs font-mono text-fg-dim mb-1">Tunnel</label>
        <select value={tunnelUuid} onChange={e => setTunnelUuid(e.target.value)}
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-4 font-mono">
          {tunnels.map((t: Tunnel) => <option key={t.uuid} value={t.uuid}>{t.name} ({t.uuid.slice(0, 8)})</option>)}
        </select>

        {error && (
          <div className="text-red-300 text-[11px] mb-3 font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
            {error}
            {conflictRetry && (
              <div className="mt-2 text-fg-dim">
                A DNS record already exists at this hostname. Click <span className="text-fg-muted">Overwrite existing record</span> to replace it
                with the tunnel CNAME. Old record content will be lost.
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-fg-muted hover:text-fg">Cancel</button>
          {conflictRetry && (
            <button onClick={() => submit(true)} disabled={submitting}
              className="bg-yellow-600 hover:bg-yellow-500 text-bg rounded-md px-4 py-2 text-xs font-semibold flex items-center gap-2">
              {submitting && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
              Overwrite existing record
            </button>
          )}
          <button onClick={() => submit(false)} disabled={!finalHostname || !tunnelUuid || submitting}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-40 flex items-center gap-2">
            {submitting && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
            {submitting ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save' : 'Add page')}
          </button>
        </div>
      </div>
    </div>
  );
}
