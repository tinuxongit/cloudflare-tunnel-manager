import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import { ApiTokenSection } from '@/components/ApiTokenSection';
import { GlobalKeySection } from '@/components/GlobalKeySection';
import { ConnectionSection } from '@/components/ConnectionSection';
import { SetupSection } from '@/components/SetupSection';
import { PageShell, PageHeader } from '@/components/PageShell';

export function SettingsView() {
  const { settings, tunnels, cloudflared, refreshSettings } = useStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true); setLoadError(null);
    try { await refreshSettings(); }
    catch (e: any) { setLoadError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }

  // Try once on mount if settings didn't load at app boot.
  useEffect(() => { if (!settings) reload(); }, []);

  async function set<K extends keyof NonNullable<typeof settings>>(k: K, v: any) {
    await api.setSettings({ [k]: v } as any);
    await reload();
  }

  // Settings can fail to load (remote mode without a configured URL, local
  // backend unreachable, etc). Don't lock the user out — always render the
  // Connection switcher + Setup + Cloudflare-access sections so they can recover.
  return (
    <PageShell maxWidth="780px">
      <PageHeader title="Settings"
        subtitle="Connection, Cloudflare access, and per-tunnel options." />

      <div className="space-y-8">
        <SetupSection />

        <Section title="Connection">
          <ConnectionSection />
        </Section>

        {!settings && (
          <div className="space-y-2">
            <div className="text-[11px] text-yellow-300 bg-yellow-950/20 border border-yellow-900/50 rounded p-3">
              Settings unavailable. Usually means remote mode is on but no remote URL is configured, or
              the local backend isn't reachable. Switch back to local in the Connection section above to recover.
            </div>
            {loadError && (
              <div className="text-red-300 text-[11px] font-mono break-words bg-red-950/20 border border-red-900/50 rounded p-2">
                {loadError}
              </div>
            )}
            <button onClick={reload} disabled={loading}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        <Section title="Cloudflare access">
          <AccessAuthSwitcher />
        </Section>

        {settings && (
          <>
            <Section title="Tunnels">
              <Row label="Grouping mode" help="shared = one cloudflared proc for all pages. isolated = one proc per page.">
                <select value={settings.grouping_mode}
                  onChange={e => set('grouping_mode', e.target.value)}
                  className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono">
                  <option value="shared">shared</option>
                  <option value="isolated">isolated</option>
                </select>
              </Row>

              <Row label="Shared tunnel" help="Used in shared mode to host all pages.">
                <select value={settings.shared_tunnel_uuid ?? ''}
                  onChange={e => set('shared_tunnel_uuid', e.target.value)}
                  className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono">
                  <option value="">— pick a tunnel —</option>
                  {tunnels.map(t => <option key={t.uuid} value={t.uuid}>{t.name}</option>)}
                </select>
              </Row>

              <Row
                label="cloudflared path"
                help="Auto-discovered. Override only if you need to point at a custom build."
              >
                <input
                  value={settings.cloudflared_path ?? cloudflared?.path ?? ''}
                  onChange={(e) => set('cloudflared_path', e.target.value || null)}
                  placeholder={cloudflared?.path ?? 'auto'}
                  className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono w-full text-fg-muted"
                />
              </Row>
            </Section>
          </>
        )}
      </div>
    </PageShell>
  );
}

function AccessAuthSwitcher() {
  const [mode, setMode] = useState<'token' | 'global'>('token');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg border border-border-strong rounded-md p-1 w-fit text-xs font-mono">
        <button
          onClick={() => setMode('token')}
          className={`px-3 py-1 rounded ${mode === 'token' ? 'bg-zinc-700 text-fg' : 'text-fg-muted hover:text-fg'}`}>
          API Token (recommended)
        </button>
        <button
          onClick={() => setMode('global')}
          className={`px-3 py-1 rounded ${mode === 'global' ? 'bg-zinc-700 text-fg' : 'text-fg-muted hover:text-fg'}`}>
          Global API Key (legacy)
        </button>
      </div>
      {mode === 'token' ? <ApiTokenSection /> : <GlobalKeySection />}
      <div className="text-[11px] text-fg-dim">
        Both methods coexist. The app prefers the API Token if both are saved. Remove one to force the other.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[12px] uppercase tracking-wider text-fg-muted font-semibold mb-4 pb-2 border-b border-border-subtle">{title}</h3>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {help && <div className="text-[11px] text-fg-dim mt-1">{help}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
