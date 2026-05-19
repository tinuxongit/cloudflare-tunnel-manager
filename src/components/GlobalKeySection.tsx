import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';

const KEY_URL = 'https://dash.cloudflare.com/profile/api-tokens';

function maskKey(raw: string): string {
  if (raw.length <= 12) return '•'.repeat(raw.length);
  return `${raw.slice(0, 4)}${'•'.repeat(raw.length - 8)}${raw.slice(-4)}`;
}

export function GlobalKeySection() {
  const { refreshZones, refreshTokenState } = useStore();
  const [hasKey, setHasKey] = useState(false);
  const [savedEmail, setSavedEmail] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function refresh() {
    const has = await api.hasGlobalKey();
    setHasKey(has);
    if (has) {
      const g = await api.getGlobalKey();
      if (g) { setSavedEmail(g[0]); setSavedKey(g[1]); }
    } else {
      setSavedEmail(''); setSavedKey('');
    }
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.setGlobalKey(email.trim(), key.trim());
      await refresh();
      await refreshTokenState();   // hasToken depends on either credential
      setEditing(false);
      setEmail(''); setKey('');
      setRevealed(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3500);
      try { await refreshZones(); } catch {}
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  async function clear() {
    if (!confirm('Remove the saved Global API Key?')) return;
    await api.clearGlobalKey();
    await refresh();
    await refreshTokenState();
    useStore.setState({ zones: [] });
  }

  const showKey = editing ? key : (revealed ? savedKey : maskKey(savedKey));

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Global API Key (legacy)</div>
      <div className="text-[11px] text-fg-dim leading-relaxed">
        Full account access. Less secure than a scoped API Token but supports everything by default.
        Email is the one your Cloudflare account uses. Both values are stored in the OS keyring.
        <br />
        <span className="text-fg-muted">Find it: </span>
        <a
          href={KEY_URL}
          onClick={(e) => { e.preventDefault(); openExternal(KEY_URL); }}
          className="text-fg underline underline-offset-2 hover:text-white font-mono"
        >{KEY_URL}</a>
        <span className="text-fg-dim"> → bottom of the page → <span className="text-fg-muted">Global API Key</span> → View.</span>
      </div>

      {justSaved && (
        <div className="text-xs font-mono px-3 py-2 bg-green-950/40 border border-green-700/40 text-green-300 rounded">
          ✓ Global key verified and saved.
        </div>
      )}

      {(hasKey || editing) && (
        <div className="space-y-2">
          <input
            type={editing ? 'email' : 'text'}
            value={editing ? email : savedEmail}
            readOnly={!editing}
            placeholder={editing ? 'account email' : ''}
            onChange={e => setEmail(e.target.value)}
            className={`w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono
              ${!editing ? 'text-fg-muted cursor-default' : ''}`}
          />
          <div className="flex gap-2 items-center">
            <input
              type={revealed || editing ? 'text' : 'password'}
              value={showKey}
              readOnly={!editing}
              placeholder={editing ? 'global API key' : ''}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => { if (editing && e.key === 'Enter' && email && key && !saving) save(); }}
              className={`flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono
                ${!editing ? 'text-fg-muted cursor-default' : ''}`}
            />
            {hasKey && !editing && (
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
        </div>
      )}

      {error && (
        <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
          {error}
        </div>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        {!editing && !hasKey && (
          <button onClick={() => setEditing(true)}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold">
            Add global key
          </button>
        )}
        {!editing && hasKey && (
          <>
            <button onClick={() => { setEditing(true); setEmail(savedEmail); setKey(''); setRevealed(false); }}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold">
              Replace
            </button>
            <button onClick={clear} className="text-red-400 hover:text-red-300 text-xs px-3 py-1.5">Remove</button>
          </>
        )}
        {editing && (
          <>
            <button onClick={save} disabled={!email || !key || saving}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 flex items-center gap-2">
              {saving && <span className="w-3 h-3 border border-bg border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Verifying…' : 'Save + verify'}
            </button>
            <button onClick={() => { setEditing(false); setEmail(''); setKey(''); setError(null); }}
              className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
          </>
        )}
      </div>
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
