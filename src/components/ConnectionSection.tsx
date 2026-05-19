import { useState } from 'react';
import { api } from '@/lib/ipc';
import { getConnection, setConnection } from '@/lib/connection';
import type { ConnectionMode } from '@/lib/connection';

const DEFAULT_BASE_URL = 'http://192.168.1.50:8088';

type HealthResult = { ok: boolean; version: string; paired: boolean } | null;

export function ConnectionSection() {
  const conn = getConnection();
  const [mode, setMode] = useState<ConnectionMode>(conn.mode);
  const [baseUrl, setBaseUrl] = useState<string>(
    conn.remote?.baseUrl ?? DEFAULT_BASE_URL,
  );
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<HealthResult>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [justPaired, setJustPaired] = useState(false);

  // Derive whether we already have a saved token for this base URL
  const hasSavedToken =
    conn.remote !== null &&
    conn.remote.baseUrl === baseUrl &&
    conn.remote.token.length > 0;

  function switchMode(next: ConnectionMode) {
    setMode(next);
    setHealth(null);
    setHealthError(null);
    setPairingError(null);
    setJustPaired(false);
    // Persist mode change immediately; transport switches on next api call
    setConnection({ mode: next, remote: conn.remote });
    location.reload();
  }

  async function checkConnector() {
    setChecking(true);
    setHealth(null);
    setHealthError(null);
    setPairingError(null);
    setJustPaired(false);
    try {
      const result = await api.remoteSystemHealth(baseUrl.trim());
      setHealth(result);
    } catch (e: unknown) {
      setHealthError(
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : String(e),
      );
    } finally {
      setChecking(false);
    }
  }

  async function pair() {
    setPairing(true);
    setPairingError(null);
    try {
      const result = await api.remotePair(baseUrl.trim(), pairingCode.trim());
      setConnection({ mode: 'remote', remote: { baseUrl: baseUrl.trim(), token: result.token } });
      setJustPaired(true);
      setPairingCode('');
      location.reload();
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : String(e);
      setPairingError(
        msg.toLowerCase().includes('expir') || msg.toLowerCase().includes('invalid')
          ? `${msg} — if the code expired, run "cf-tunnel-connector show-code" on the server (or restart the connector) to get a fresh one.`
          : msg,
      );
    } finally {
      setPairing(false);
    }
  }

  function forget() {
    if (!confirm('Remove the saved connector token? You will need to pair again to use Remote mode.'))
      return;
    setConnection({ mode: 'local', remote: null });
    location.reload();
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle pill */}
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

      {/* Local panel */}
      {mode === 'local' && (
        <div className="text-[11px] text-fg-dim leading-relaxed">
          Manager controls this PC directly via embedded Rust. No network involved.
        </div>
      )}

      {/* Remote panel */}
      {mode === 'remote' && (
        <div className="space-y-4">
          {/* Base URL input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-fg">Connector base URL</label>
            <div className="flex gap-2">
              <input
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setHealth(null);
                  setHealthError(null);
                }}
                placeholder={DEFAULT_BASE_URL}
                className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono"
              />
              <button
                onClick={checkConnector}
                disabled={checking || !baseUrl.trim()}
                className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2 whitespace-nowrap"
              >
                {checking && (
                  <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />
                )}
                {checking ? 'Checking…' : 'Check connector'}
              </button>
            </div>
          </div>

          {/* Health error */}
          {healthError && (
            <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
              {healthError}
            </div>
          )}

          {/* Health result */}
          {health && !healthError && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
                <span className="px-2 py-1 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
                  reachable
                </span>
                <span className="px-2 py-1 bg-bg border border-border-strong text-fg-muted rounded">
                  v{health.version}
                </span>
                <span
                  className={`px-2 py-1 border rounded ${
                    health.paired
                      ? 'bg-green-950/40 border-green-700/40 text-green-300'
                      : 'bg-yellow-950/40 border-yellow-700/40 text-yellow-300'
                  }`}
                >
                  {health.paired ? 'paired' : 'not paired'}
                </span>
              </div>

              {/* Already paired + token saved */}
              {health.paired && hasSavedToken && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="px-2 py-1 bg-green-950/40 border border-green-700/40 text-green-300 rounded text-xs font-mono">
                    Connected
                  </span>
                  <button
                    onClick={forget}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
                  >
                    Forget
                  </button>
                </div>
              )}

              {/* Paired but no local token — offer to re-pair */}
              {health.paired && !hasSavedToken && (
                <div className="text-[11px] text-yellow-300 font-mono bg-yellow-950/20 border border-yellow-900/50 rounded p-2">
                  Connector is paired but this manager has no saved token. Run
                  "cf-tunnel-connector show-code" on the server and paste the code below
                  to obtain a token.
                </div>
              )}

              {/* Not paired — show pairing flow */}
              {!health.paired && (
                <div className="space-y-2">
                  <div className="text-[11px] text-fg-dim">
                    Paste the pairing code printed by the connector at startup (or run
                    <span className="font-mono text-fg-muted"> cf-tunnel-connector show-code</span>
                    ).
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={pairingCode}
                      onChange={(e) => setPairingCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && pairingCode.trim() && !pairing) pair();
                      }}
                      placeholder="8-character pairing code"
                      className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono tracking-widest"
                    />
                    <button
                      onClick={pair}
                      disabled={pairing || !pairingCode.trim()}
                      className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2 whitespace-nowrap"
                    >
                      {pairing && (
                        <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />
                      )}
                      {pairing ? 'Pairing…' : 'Pair manager'}
                    </button>
                  </div>
                  {pairingError && (
                    <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
                      {pairingError}
                    </div>
                  )}
                </div>
              )}

              {/* Also show pairing row when paired but no local token */}
              {health.paired && !hasSavedToken && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={pairingCode}
                      onChange={(e) => setPairingCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && pairingCode.trim() && !pairing) pair();
                      }}
                      placeholder="8-character pairing code"
                      className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono tracking-widest"
                    />
                    <button
                      onClick={pair}
                      disabled={pairing || !pairingCode.trim()}
                      className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2 whitespace-nowrap"
                    >
                      {pairing && (
                        <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />
                      )}
                      {pairing ? 'Pairing…' : 'Pair manager'}
                    </button>
                  </div>
                  {pairingError && (
                    <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
                      {pairingError}
                    </div>
                  )}
                </div>
              )}

              {justPaired && (
                <div className="text-xs font-mono px-3 py-2 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
                  Paired and connected. Reloading…
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-fg-dim">
            Pairing codes expire after ~10 minutes. If pairing fails with an expiry error,
            run <span className="font-mono text-fg-muted">cf-tunnel-connector show-code</span> on
            the server (or restart the connector) to get a fresh one.
          </div>
        </div>
      )}
    </div>
  );
}
