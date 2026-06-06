import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/ipc';
import { getConnection, setConnection } from '@/lib/connection';
import type { ConnectionMode } from '@/lib/connection';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDeployTerminal } from '@/lib/deployTerminal';
import { useStore } from '@/lib/store';

export function ConnectionSection() {
  const conn = getConnection();
  const confirm = useConfirm();
  const [mode, setMode] = useState<ConnectionMode>(conn.mode);

  function switchMode(next: ConnectionMode) {
    setMode(next);
    setConnection({ mode: next, remote: conn.remote });
    location.reload();
  }

  async function forget() {
    const ok = await confirm({
      title: 'Disconnect from the server?',
      message: 'Studio will go back to controlling this PC. Run the connector again on the server to re-pair.',
      variant: 'danger',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    setConnection({ mode: 'local', remote: null });
    location.reload();
  }

  const isConnected = mode === 'remote' && conn.remote && conn.remote.token.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg border border-border-strong rounded-md p-1 w-fit text-xs font-mono">
        <button
          onClick={() => mode !== 'local' && switchMode('local')}
          className={`px-3 py-1 rounded ${
            mode === 'local' ? 'bg-zinc-700 text-fg' : 'text-fg-muted hover:text-fg'
          }`}
        >
          Local
        </button>
        <button
          onClick={() => mode !== 'remote' && switchMode('remote')}
          className={`px-3 py-1 rounded ${
            mode === 'remote' ? 'bg-zinc-700 text-fg' : 'text-fg-muted hover:text-fg'
          }`}
        >
          Remote
        </button>
      </div>

      {mode === 'local' && (
        <div className="text-[11px] text-fg-dim leading-relaxed">
          Studio controls this PC directly via embedded Rust. No network involved.
        </div>
      )}

      {mode === 'remote' && (
        <div className="space-y-4">
          {isConnected ? (
            <ConnectedPanel baseUrl={conn.remote!.baseUrl} onForget={forget} />
          ) : (
            <PairFlow onPaired={() => location.reload()} />
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedPanel({ baseUrl, onForget }: { baseUrl: string; onForget: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  async function pushCreds() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await api.pushCredentialsToConnector();
      setSyncMsg({ text: '✓ Sent your saved Cloudflare credentials to the server.', tone: 'ok' });
    } catch (e: any) {
      setSyncMsg({ text: e?.message ?? String(e), tone: 'err' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="px-2 py-1 bg-green-950/40 border border-green-700/40 text-green-300 rounded text-xs font-mono">
          Connected
        </span>
        <span className="text-[11px] font-mono text-fg-dim break-all">{baseUrl}</span>
        <button
          onClick={pushCreds}
          disabled={syncing}
          title="Re-sync the CF token saved on this PC to the server. Use this if Tunnels/Workers/etc. start returning 500s — usually means the server's keyring lost the token."
          className="h-7 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev disabled:opacity-40"
        >
          {syncing ? 'Syncing…' : 'Sync credentials'}
        </button>
        <button onClick={onForget} className="text-red-400 hover:text-red-300 text-xs px-2 py-1">
          Disconnect
        </button>
      </div>
      {syncMsg && (
        <div
          className={`text-[11px] font-mono rounded p-2 ${
            syncMsg.tone === 'ok'
              ? 'text-green-300 bg-green-950/30 border border-green-900/50'
              : 'text-red-300 bg-red-950/30 border border-red-900/50'
          }`}
        >
          {syncMsg.text}
        </div>
      )}
      <RemoteSetupPanel />
    </div>
  );
}

// ── Code-paste pairing ────────────────────────────────────────────────────

function PairFlow({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const { baseUrl, token } = await api.pairFromCode(code);
      setConnection({ mode: 'remote', remote: { baseUrl, token } });
      // Push the laptop's saved CF creds to the server so the same account
      // works on both sides. Best-effort — pairing already succeeded.
      try { await api.pushCredentialsToConnector(); } catch (e) { console.warn('credentials sync failed:', e); }
      onPaired();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-bg/60 border border-border-strong rounded-md p-4 space-y-3">
        <div className="text-sm font-semibold text-fg">Pair a server</div>
        <ol className="text-[11px] text-fg-muted leading-relaxed list-decimal pl-4 space-y-1">
          <li>Drop <code className="font-mono text-fg">cf-tunnel-connector.exe</code> on the server and run it.</li>
          <li>On first start it downloads cloudflared (no manual install needed) and prints a paste code.</li>
          <li>Copy the code from the connector window, paste it below.</li>
        </ol>

        <div className="space-y-2">
          <input
            value={code}
            onChange={(e) => { setCode(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && code.trim() && !busy) connect(); }}
            placeholder="example-words-here-XYZK"
            spellCheck={false}
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-2.5 text-sm font-mono"
          />
          <button
            onClick={connect}
            disabled={!code.trim() || busy}
            className="bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-40 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset] flex items-center gap-2"
          >
            {busy && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>

        {err && (
          <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-2 whitespace-pre-wrap">
            {err}
          </div>
        )}
      </div>

      <div className="text-[11px] text-fg-dim leading-relaxed">
        Your Cloudflare account stays signed in on this PC — Studio shares it with the server automatically
        after pairing, so you don't have to re-enter the token there.
      </div>
    </div>
  );
}

// ── One-click remote environment setup (post-pair) ─────────────────────────

function RemoteSetupPanel() {
  const startDeployTerminal = useDeployTerminal((s) => s.start);
  // Drive the missing list from the global store — the realtime SSE bus
  // publishes ToolsChanged on every per-tool install completion, the store
  // calls refreshSetup() in response, and this panel re-renders. Net effect:
  // the "3 missing" list ticks down to 2, 1, done as installs progress.
  const { setupTools, setupError, refreshSetup } = useStore();
  const [busy, setBusy] = useState(false);

  // Re-detect once on mount so we don't show a stale view if the user
  // edited tooling on the server out-of-band.
  useEffect(() => { refreshSetup(); }, []);

  const missing = useMemo(() => {
    if (setupTools === null) return null;
    return setupTools.filter(
      (t) => !t.installed && t.install &&
      (t.importance === 'essential' || t.importance === 'recommended')
    );
  }, [setupTools]);

  async function install() {
    setBusy(true);
    try {
      const eventId = await api.installAllTools();
      await startDeployTerminal('Setting up remote environment', eventId, () => {
        setBusy(false);
        refreshSetup();
      });
    } catch (e: any) {
      console.error(e);
      setBusy(false);
    }
  }

  if (missing === null) {
    return <div className="text-[11px] text-fg-dim font-mono">Checking remote environment…</div>;
  }
  if (setupError) {
    return (
      <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-2">
        {setupError}
      </div>
    );
  }
  if (missing.length === 0) {
    return (
      <div className="bg-green-950/20 border border-green-900/40 rounded-md p-3 text-[11px] text-green-300/90">
        Remote environment is ready — every essential tool is already installed.
      </div>
    );
  }
  return (
    <div className="bg-bg/60 border border-border-strong rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold text-fg">Set up remote environment</div>
          <div className="text-[11px] text-fg-dim mt-0.5">
            {missing.length} tool{missing.length === 1 ? '' : 's'} missing on the server. One click installs them all.
          </div>
        </div>
        <button
          onClick={install}
          disabled={busy}
          className="bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]"
        >
          {busy ? 'Installing…' : `Install ${missing.length} tool${missing.length === 1 ? '' : 's'}`}
        </button>
      </div>
      <ul className="text-[11px] font-mono text-fg-muted space-y-0.5 pt-1">
        {missing.map((t) => (
          <li key={t.id} className="flex items-baseline gap-2">
            <span className={t.importance === 'essential' ? 'text-yellow-300' : 'text-fg-dim'}>
              {t.importance === 'essential' ? '●' : '○'}
            </span>
            <span className="text-fg">{t.label}</span>
            <span className="text-fg-dim text-[10px]">
              via {t.install?.kind ?? '—'}
              {t.install?.kind === 'manual' && t.install?.target ? ` (${t.install.target})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
