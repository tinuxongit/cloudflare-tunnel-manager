import { useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api } from '@/lib/ipc';
import type { Detected, Page, Tunnel } from '@/lib/types';
import { useStore } from '@/lib/store';

type Props = {
  open: boolean;
  onClose: () => void;
  editing?: Page | null;
};

function DropSetupGuideButton({ sourceDir }: { sourceDir: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  async function drop() {
    setBusy(true); setResult(null);
    try {
      const path = await api.writeSetupGuide(sourceDir);
      setResult({ ok: true, msg: `Wrote ${path}` });
    } catch (e: any) {
      setResult({ ok: false, msg: e?.message ?? String(e) });
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 pt-3 border-t border-border-subtle">
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={drop} disabled={busy}
          className="bg-bg-elev border border-border-strong rounded-md px-3 py-1.5 text-xs font-mono hover:bg-zinc-800 text-fg-muted hover:text-fg disabled:opacity-40">
          {busy ? 'writing…' : '📄 Drop TUNNEL_MANAGER.md in this folder'}
        </button>
        {result && (
          <span className={`text-[11px] font-mono ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
            {result.msg}
          </span>
        )}
      </div>
      <div className="text-[10px] text-fg-faint mt-2 leading-relaxed">
        Drops a markdown file explaining the contract (PORT env var, 127.0.0.1 bind, no embedded
        cloudflared) into the folder. Hand it to a teammate so they can adapt the project
        without breaking the manager's spawn flow.
      </div>
    </div>
  );
}

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
  const [conflictRetry, setConflictRetry] = useState(false);

  // Deploy-from-folder fields
  const [mode, setMode] = useState<'folder' | 'manual'>('folder');
  const [sourceDir, setSourceDir] = useState('');
  const [runCommand, setRunCommand] = useState('');
  const [detected, setDetected] = useState<Detected | null>(null);
  const [detecting, setDetecting] = useState(false);

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
      setSourceDir(editing.source_dir ?? '');
      setRunCommand(editing.run_command ?? '');
      setMode(editing.source_dir ? 'folder' : 'manual');
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
      setSourceDir('');
      setRunCommand('');
      setMode('folder');
      setDetected(null);
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

  async function pickFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string' && picked) {
      setSourceDir(picked);
      setDetecting(true);
      try {
        const d = await api.detectFolder(picked);
        setDetected(d);
        // Auto-fill the command if the user hasn't customized it yet
        if (!runCommand || runCommand === detected?.command) {
          setRunCommand(d.command);
        }
      } catch (e: any) {
        setDetected({ kind: 'not_found', command: '', note: e?.message ?? String(e) });
      } finally { setDetecting(false); }
    }
  }

  async function submit(overwrite = false) {
    setSubmitting(true); setError(null); setConflictRetry(false);
    try {
      if (!finalHostname) {
        setError('Hostname is empty.');
        setSubmitting(false);
        return;
      }

      const usingFolder = mode === 'folder' && sourceDir.trim();
      if (usingFolder && !runCommand.trim()) {
        setError('Folder mode needs a run command. Pick a folder again or fill it manually.');
        setSubmitting(false);
        return;
      }

      // Manual mode = user-supplied serviceUrl. Folder mode = service_url is a
      // placeholder; start_or_restart_for_page rewrites it once the local
      // proc has an assigned port.
      const initialServiceUrl = usingFolder ? 'http://localhost:0' : serviceUrl;
      const sourceDirVal: string | null = usingFolder ? sourceDir.trim() : null;
      const runCommandVal: string | null = usingFolder ? runCommand.trim() : null;

      if (isEdit && editing) {
        const hostnameChanged = editing.hostname !== finalHostname;
        const tunnelChanged = editing.tunnel_uuid !== tunnelUuid;
        if (hostnameChanged || tunnelChanged) {
          await doRouteDns(finalHostname, overwrite);
        }
        await api.updatePage(editing.id, {
          hostname: finalHostname,
          service_url: usingFolder ? editing.service_url : serviceUrl,
          tunnel_uuid: tunnelUuid,
          source_dir: sourceDirVal,
          run_command: runCommandVal,
        });
        await api.startOrRestartForPage(editing.id);
      } else {
        await doRouteDns(finalHostname, overwrite);
        await api.createPage({
          hostname: finalHostname,
          service_url: initialServiceUrl,
          tunnel_uuid: tunnelUuid,
          source_dir: sourceDirVal,
          run_command: runCommandVal,
        });
      }
      await refreshPages();
      onClose();
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      setError(msg);
      if (!overwrite && /code:\s*1003|81053|81057|already exists|identical record/i.test(msg)) {
        setConflictRetry(true);
      }
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-[520px] max-h-[90vh] bg-bg-elev border border-border-strong rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3 border-b border-border-subtle">
          <h3 className="text-base font-semibold">{isEdit ? 'Edit page' : 'Add page'}</h3>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">

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

        <div className="flex gap-1 bg-bg border border-border-strong rounded-md p-1 w-fit text-xs font-mono mb-3">
          <button
            type="button"
            onClick={() => setMode('folder')}
            className={`px-3 py-1 rounded ${mode === 'folder' ? 'bg-zinc-700 text-fg' : 'text-fg-muted hover:text-fg'}`}>
            Deploy a folder
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`px-3 py-1 rounded ${mode === 'manual' ? 'bg-zinc-700 text-fg' : 'text-fg-muted hover:text-fg'}`}>
            Use existing server
          </button>
        </div>

        {mode === 'folder' ? (
          <div className="space-y-2 mb-3">
            <label className="block text-xs font-mono text-fg-dim">Folder</label>
            <div className="flex gap-2">
              <input
                value={sourceDir}
                onChange={e => setSourceDir(e.target.value)}
                placeholder="C:\path\to\your\app"
                className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono" />
              <button type="button" onClick={pickFolder}
                className="bg-bg-elev border border-border-strong rounded-md px-3 py-2 text-xs font-mono hover:bg-zinc-800 text-fg-muted hover:text-fg">
                Browse…
              </button>
            </div>
            {detecting && <div className="text-[11px] text-fg-dim font-mono">detecting…</div>}
            {detected && (
              <div className={`text-[11px] font-mono p-2 rounded
                ${detected.kind === 'not_found' || detected.kind === 'empty'
                  ? 'text-red-300 bg-red-950/20 border border-red-900/50'
                  : 'text-fg-muted bg-bg border border-border-subtle'}`}>
                <div className="text-fg">{detected.kind.replace('_', ' ')}</div>
                <div className="text-fg-dim mt-1">{detected.note}</div>
              </div>
            )}

            <label className="block text-xs font-mono text-fg-dim mt-2">Run command <span className="text-fg-faint">(use {'{PORT}'} for the auto-assigned port)</span></label>
            <input
              value={runCommand}
              onChange={e => setRunCommand(e.target.value)}
              placeholder="npm start"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono" />
            <div className="text-[10px] text-fg-faint">
              App spawns this in the folder with <span className="font-mono">PORT</span> env set. cloudflared
              forwards your hostname to <span className="font-mono">localhost:&lt;auto-port&gt;</span>.
            </div>

            {sourceDir && (
              <DropSetupGuideButton sourceDir={sourceDir} />
            )}
          </div>
        ) : (
          <div className="mb-3">
            <label className="block text-xs font-mono text-fg-dim mb-1">Local service URL</label>
            <input value={serviceUrl} onChange={e => setServiceUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono" />
            <div className="text-[10px] text-fg-faint mt-1">
              Point at a server you already run yourself (e.g. <span className="font-mono">node server.js</span>, dev server on :5173).
            </div>
          </div>
        )}

        <label className="block text-xs font-mono text-fg-dim mb-1">Tunnel</label>
        <select value={tunnelUuid} onChange={e => setTunnelUuid(e.target.value)}
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-4 font-mono">
          {tunnels.map((t: Tunnel) => <option key={t.uuid} value={t.uuid}>{t.name} ({t.uuid.slice(0, 8)})</option>)}
        </select>

        {error && (
          <div className="text-red-300 text-[11px] mb-3 font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2 max-h-40 overflow-y-auto">
            {error}
            {conflictRetry && (
              <div className="mt-2 text-fg-dim">
                A DNS record already exists at this hostname. Click <span className="text-fg-muted">Overwrite existing record</span> below to replace it
                with the tunnel CNAME. Old record content will be lost.
              </div>
            )}
          </div>
        )}

        </div>{/* end scrollable body */}

        <div className="px-6 py-4 border-t border-border-subtle flex justify-end gap-2 bg-bg-elev rounded-b-xl">
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
