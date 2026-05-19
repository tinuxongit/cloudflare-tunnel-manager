import { useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import { ApiTokenSection } from '@/components/ApiTokenSection';
import { GlobalKeySection } from '@/components/GlobalKeySection';

export function SettingsView() {
  const { settings, tunnels, cloudflared, refreshSettings } = useStore();

  async function set<K extends keyof NonNullable<typeof settings>>(k: K, v: any) {
    await api.setSettings({ [k]: v } as any);
    await refreshSettings();
  }

  if (!settings) return <div className="p-8 text-fg-dim">Loading settings…</div>;

  return (
    <div>
      <div className="px-7 py-5 border-b border-border-subtle">
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>
      <div className="p-7 max-w-2xl space-y-8">

        <Section title="Cloudflare access">
          <AccessAuthSwitcher />
        </Section>

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

          <Row label="cloudflared path" help="Absolute path to cloudflared executable.">
            <input value={settings.cloudflared_path ?? cloudflared?.path ?? ''}
              onChange={e => set('cloudflared_path', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono w-full" />
          </Row>
        </Section>

        <Section title="App">
          <Row label="Theme">
            <select value={settings.theme} onChange={e => set('theme', e.target.value)}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono">
              <option value="dark">dark</option>
              <option value="light">light</option>
              <option value="system">system</option>
            </select>
          </Row>
          <Row label="Start on boot">
            <input type="checkbox" checked={settings.start_on_boot}
              onChange={e => set('start_on_boot', e.target.checked)} />
          </Row>
        </Section>

      </div>
    </div>
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
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-fg-dim mb-4 pb-2 border-b border-border-subtle">{title}</h3>
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
