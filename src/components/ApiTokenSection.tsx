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
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => { refreshTokenState(); }, []);
  useEffect(() => {
    if (hasToken && zones.length === 0) refreshZones();
  }, [hasToken]);

  async function save() {
    setSaving(true); setError(null); setVerified(null);
    try {
      // setApiToken now verifies first, then stores. Any failure -> thrown.
      await api.setApiToken(token.trim());
      setVerified(true);
      await refreshTokenState();
      await refreshZones();
      setEditing(false);
      setToken('');
    } catch (e: any) {
      // Surface the actual reason (HTTP status, CF error message, DNS, etc.)
      setError(e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  async function clear() {
    if (!confirm('Remove the saved API token? Domain dropdown will go back to free-text hostname entry.')) return;
    await api.clearApiToken();
    await refreshTokenState();
    useStore.setState({ zones: [] });
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
        Use template <span className="font-mono text-fg-muted">"Read all resources"</span> or
        create a custom token with permission <span className="font-mono text-fg-muted">Zone &gt; Zone &gt; Read</span> across all zones.
      </div>

      {!editing && hasToken && (
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="px-2 py-1 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
            ✓ token saved · {zones.length} zone{zones.length === 1 ? '' : 's'}
          </span>
          <button onClick={() => setEditing(true)} className="text-fg-muted hover:text-fg">Replace</button>
          <button onClick={clear} className="text-red-400 hover:text-red-300">Remove</button>
        </div>
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
            placeholder="paste token here"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono" />
          {error && <div className="text-red-400 text-xs font-mono">{error}</div>}
          {verified === true && <div className="text-green-400 text-xs font-mono">verified ✓</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={!token || saving}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2">
              {saving && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Verifying…' : 'Save + verify'}
            </button>
            <button onClick={() => { setEditing(false); setToken(''); setError(null); setVerified(null); }}
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
