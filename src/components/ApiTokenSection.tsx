import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';

const TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';

export function ApiTokenSection() {
  const { hasToken, zones, refreshTokenState, refreshZones } = useStore();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => { refreshTokenState(); }, []);

  useEffect(() => {
    if (!hasToken) return;
    (async () => {
      setZoneError(null);
      try {
        await refreshZones();
      } catch (e: any) {
        setZoneError(e?.message ?? String(e));
      }
    })();
  }, [hasToken]);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.setApiToken(token.trim());
      // Token saved + verified by backend. Now load zones.
      await refreshTokenState();
      setEditing(false);
      setToken('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3500);
      // Load zones — separate try so a zones failure doesn't undo the saved state.
      try { await refreshZones(); setZoneError(null); }
      catch (e: any) { setZoneError(e?.message ?? String(e)); }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  async function clear() {
    if (!confirm('Remove the saved API token? Domain dropdown will go back to free-text hostname entry.')) return;
    await api.clearApiToken();
    await refreshTokenState();
    setZoneError(null);
    useStore.setState({ zones: [] });
  }

  async function reloadZones() {
    setZoneError(null);
    try { await refreshZones(); }
    catch (e: any) { setZoneError(e?.message ?? String(e)); }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Cloudflare API token</div>
      <div className="text-[11px] text-fg-dim leading-relaxed">
        Optional. Lets the app list your owned domains for the Add page dialog (zone dropdown
        instead of free-text). Token is stored in the OS keyring (Windows Credential Manager),
        not in the SQLite DB.
        <br />
        <span className="text-fg-muted">Get a token: </span>
        <a
          href={TOKEN_URL}
          onClick={(e) => { e.preventDefault(); openExternal(TOKEN_URL); }}
          className="text-fg underline underline-offset-2 hover:text-white font-mono"
        >{TOKEN_URL}</a>
        <br />
        Use template <span className="font-mono text-fg-muted">"Read all resources"</span> or a
        custom token with permission <span className="font-mono text-fg-muted">Zone &gt; Zone &gt; Read</span> across all zones.
      </div>

      {justSaved && (
        <div className="text-xs font-mono px-3 py-2 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
          ✓ Token verified and saved to keyring.
        </div>
      )}

      {!editing && hasToken && (
        <>
          <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
            <span className="px-2 py-1 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
              ✓ token saved
            </span>
            {zoneError
              ? <span className="px-2 py-1 bg-red-950/40 border border-red-700/40 text-red-300 rounded">
                  zones: error
                </span>
              : <span className="px-2 py-1 bg-bg border border-border-strong text-fg-muted rounded">
                  {zones.length} zone{zones.length === 1 ? '' : 's'}
                </span>}
            <button onClick={reloadZones} className="text-fg-muted hover:text-fg">↻ Reload zones</button>
            <button onClick={() => setEditing(true)} className="text-fg-muted hover:text-fg">Replace</button>
            <button onClick={clear} className="text-red-400 hover:text-red-300">Remove</button>
          </div>

          {zoneError && (
            <div className="text-[11px] text-red-300 font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
              {zoneError}
              <div className="text-fg-dim mt-1">
                Token is valid (it verified) but listing zones failed. Most common cause: token lacks
                <span className="text-fg-muted"> Zone &gt; Zone &gt; Read</span>. Recreate the token with that permission
                across <span className="text-fg-muted">All zones</span> and click ↻ Reload zones.
              </div>
            </div>
          )}

          {!zoneError && hasToken && zones.length === 0 && (
            <div className="text-[11px] text-yellow-300 font-mono bg-yellow-950/20 border border-yellow-900/50 rounded p-2">
              No zones returned. Your token is valid but either has no Zone:Read scope, or your account has no zones.
            </div>
          )}
        </>
      )}

      {!editing && !hasToken && (
        <button onClick={() => setEditing(true)}
          className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold">
          Add token
        </button>
      )}

      {editing && (
        <div className="space-y-2">
          <input
            type="password"
            autoFocus
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && token && !saving) save(); }}
            placeholder="paste token here, press Enter to save"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono" />
          {error && <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={!token || saving}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2">
              {saving && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Verifying…' : 'Save + verify'}
            </button>
            <button onClick={() => { setEditing(false); setToken(''); setError(null); }}
              className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
          </div>
        </div>
      )}

      {hasToken && zones.length > 0 && (
        <details className="text-[11px] font-mono text-fg-dim">
          <summary className="cursor-pointer hover:text-fg">Show zones ({zones.length})</summary>
          <ul className="mt-2 space-y-1 pl-2">
            {zones.map(z => (
              <li key={z.id} className="flex justify-between gap-4">
                <span className="text-fg">{z.name}</span>
                <span className="text-fg-faint">{z.status}{z.account_name ? ` · ${z.account_name}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function openExternal(url: string) {
  openUrl(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
}
