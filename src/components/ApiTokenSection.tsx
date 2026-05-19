import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';

const CREATE_URL = 'https://dash.cloudflare.com/profile/api-tokens?token_id=create';

// Known Cloudflare permission group IDs (community-discovered, undocumented).
// If CF stops honoring these in dashboard URL params, the user still lands on
// the right page and fills the table manually.
const PG_ZONE_READ  = 'c8fed203ed3043cba015a93ad1616f1f';
const PG_DNS_EDIT   = '4755a26eedb94da69e1066d98aa820be';
const AUTOFILL_URL =
  `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=` +
  encodeURIComponent(`["${PG_ZONE_READ}","${PG_DNS_EDIT}"]`) +
  `&name=` + encodeURIComponent('Cloudflare Tunnel Manager');

const REQUIRED_PERMS: { resource: string; sub: string; action: string; reason: string }[] = [
  { resource: 'Zone', sub: 'Zone', action: 'Read',  reason: 'list your domains' },
  { resource: 'Zone', sub: 'DNS',  action: 'Edit',  reason: 'create / replace tunnel CNAMEs' },
];

function maskToken(raw: string): string {
  if (raw.length <= 12) return '•'.repeat(raw.length);
  return `${raw.slice(0, 6)}${'•'.repeat(raw.length - 11)}${raw.slice(-5)}`;
}

export function ApiTokenSection() {
  const { hasToken, zones, refreshTokenState, refreshZones } = useStore();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');         // edit-mode buffer
  const [savedToken, setSavedToken] = useState(''); // populated when hasToken
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => { refreshTokenState(); }, []);

  // Load the saved token value (for the display field) when hasToken flips true.
  useEffect(() => {
    if (!hasToken) { setSavedToken(''); return; }
    api.getApiToken().then(t => setSavedToken(t ?? ''));
  }, [hasToken]);

  useEffect(() => {
    if (!hasToken) return;
    (async () => {
      setZoneError(null);
      try { await refreshZones(); }
      catch (e: any) { setZoneError(e?.message ?? String(e)); }
    })();
  }, [hasToken]);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.setApiToken(token.trim());
      await refreshTokenState();
      setEditing(false);
      setToken('');
      setRevealed(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3500);
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
    setRevealed(false);
    setZoneError(null);
    useStore.setState({ zones: [] });
  }

  async function reloadZones() {
    setZoneError(null);
    try { await refreshZones(); }
    catch (e: any) { setZoneError(e?.message ?? String(e)); }
  }

  const showRawValue = editing ? token : (revealed ? savedToken : maskToken(savedToken));

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Cloudflare API token</div>
      <div className="text-[11px] text-fg-dim leading-relaxed">
        Scoped API token. Lets the app list your domains and create/replace CNAME records on the
        zone you pick — no cert.pem zone-guessing. Stored in the OS keyring, not in the SQLite DB.
        Click <span className="text-fg-muted">Add token</span> below for a step-by-step walkthrough.
      </div>

      {justSaved && (
        <div className="text-xs font-mono px-3 py-2 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
          ✓ Token verified and saved to keyring.
        </div>
      )}

      {editing && !hasToken && (
        <div className="space-y-3 bg-bg border border-border-strong rounded-md p-4">
          <div className="text-[11px] font-mono text-fg-dim uppercase tracking-wider">Step-by-step</div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => openExternal(AUTOFILL_URL)}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-3 py-2 text-xs font-semibold w-fit">
              ⚡ Open Cloudflare with permissions pre-filled
            </button>
            <button
              onClick={() => openExternal(CREATE_URL)}
              className="text-fg-muted hover:text-fg text-[11px] font-mono underline underline-offset-2 w-fit">
              … or open the blank form manually
            </button>
            <div className="text-[10px] text-fg-dim">
              The auto-fill link uses an undocumented Cloudflare URL parameter. If the page opens
              empty, fill the form using the steps below.
            </div>
          </div>

          <ol className="space-y-3 text-[11px] text-fg-muted list-decimal pl-5 leading-relaxed mt-3">
            <li><strong className="text-fg">Token name:</strong> anything, e.g. <span className="font-mono">Tunnel Manager</span>.</li>
            <li>
              <strong className="text-fg">Permissions</strong> — add these two rows. Each row has THREE
              dropdowns: resource type → sub-resource → action. Click <span className="font-mono">+ Add more</span> for the second row.
              <table className="mt-2 w-full text-[11px] font-mono border-collapse">
                <thead>
                  <tr className="text-fg-dim border-b border-border">
                    <th className="text-left py-1 pr-3 font-normal">1st</th>
                    <th className="text-left py-1 pr-3 font-normal">2nd</th>
                    <th className="text-left py-1 pr-3 font-normal">3rd</th>
                    <th className="text-left py-1 font-normal">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {REQUIRED_PERMS.map((p, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-b-0">
                      <td className="py-1.5 pr-3 text-fg">{p.resource}</td>
                      <td className="py-1.5 pr-3 text-fg">{p.sub}</td>
                      <td className="py-1.5 pr-3 text-fg">{p.action}</td>
                      <td className="py-1.5 text-fg-dim">{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
            <li>
              <strong className="text-fg">Zone Resources:</strong> <span className="font-mono">Include</span> → <span className="font-mono">All zones</span> (default).
            </li>
            <li>
              <strong className="text-fg text-red-300">Client IP Address Filtering:</strong> leave EMPTY.
              <span className="text-fg-dim"> Setting an IP here is the #1 cause of HTTP 401 on verify.</span>
            </li>
            <li><strong className="text-fg">TTL:</strong> leave empty (no expiration).</li>
            <li>Click <span className="font-mono text-fg">Continue to summary</span> → <span className="font-mono text-fg">Create Token</span>.</li>
            <li>Copy the token value (shown <strong>once</strong>) → paste below → Enter.</li>
          </ol>
        </div>
      )}

      {/* Show input only when a token exists (display + reveal) or while editing.
          When neither, the "Add token" button below opens the editor. */}
      {(hasToken || editing) && (
        <div className="flex gap-2 items-center">
          <input
            type={revealed || editing ? 'text' : 'password'}
            value={showRawValue}
            readOnly={!editing}
            autoFocus={editing}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => { if (editing && e.key === 'Enter' && token && !saving) save(); }}
            placeholder={editing ? 'paste token here, press Enter to save' : ''}
            className={`flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono
              ${!editing ? 'text-fg-muted cursor-default' : ''}`}
          />
          {hasToken && !editing && (
            <button
              type="button"
              title={revealed ? 'Hide' : 'Reveal'}
              onClick={() => setRevealed(v => !v)}
              className="w-9 h-9 flex items-center justify-center border border-border rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev"
            >
              {revealed ? <EyeOff /> : <Eye />}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
          {error}
        </div>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        {!editing && !hasToken && (
          <button onClick={() => { setEditing(true); setToken(''); }}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold">
            Add token
          </button>
        )}

        {!editing && hasToken && (
          <>
            <button onClick={() => { setEditing(true); setToken(''); setRevealed(false); }}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold">
              Replace
            </button>
            <button onClick={clear}
              className="text-red-400 hover:text-red-300 text-xs px-3 py-1.5">
              Remove
            </button>
            <button onClick={reloadZones}
              className="text-fg-muted hover:text-fg text-xs px-3 py-1.5">
              ↻ Reload zones
            </button>
          </>
        )}

        {editing && (
          <>
            <button onClick={save} disabled={!token || saving}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2">
              {saving && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Verifying…' : 'Save + verify'}
            </button>
            <button onClick={() => { setEditing(false); setToken(''); setError(null); }}
              className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
          </>
        )}
      </div>

      {hasToken && (
        <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
          <span className="px-2 py-1 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
            ✓ saved
          </span>
          {zoneError
            ? <span className="px-2 py-1 bg-red-950/40 border border-red-700/40 text-red-300 rounded">
                zones: error
              </span>
            : <span className="px-2 py-1 bg-bg border border-border-strong text-fg-muted rounded">
                {zones.length} zone{zones.length === 1 ? '' : 's'}
              </span>}
        </div>
      )}

      {zoneError && (
        <div className="text-[11px] text-red-300 font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
          {zoneError}
          <div className="text-fg-dim mt-1">
            Token verified but listing zones failed. Most common cause: token lacks
            <span className="text-fg-muted"> Zone &gt; Zone &gt; Read</span>. Recreate with that permission
            across <span className="text-fg-muted">All zones</span> and click ↻ Reload zones.
          </div>
        </div>
      )}

      {!zoneError && hasToken && zones.length === 0 && (
        <div className="text-[11px] text-yellow-300 font-mono bg-yellow-950/20 border border-yellow-900/50 rounded p-2">
          No zones returned. Token is valid but either lacks Zone:Read scope, or your account has no zones.
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

function Eye() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 4.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.6 18.6 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function openExternal(url: string) {
  openUrl(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
}
