import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';

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
      <div className="p-7 max-w-2xl space-y-6">

        <Row label="Tunnel grouping mode" help="shared = one cloudflared proc for all pages. isolated = one proc per page.">
          <select value={settings.grouping_mode}
            onChange={e => set('grouping_mode', e.target.value)}
            className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono">
            <option value="shared">shared</option>
            <option value="isolated">isolated</option>
          </select>
        </Row>

        <Row label="Shared tunnel UUID" help="Used in shared mode to host all pages.">
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
      </div>
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
