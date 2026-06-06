import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import type { Project } from '@/lib/types';
import { PageShell, PageHeader } from '@/components/PageShell';

export function DashboardView() {
  const { hasToken, zones, cloudflared, pages, tunnels } = useStore();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => { api.listProjects().then(setProjects).catch(() => setProjects([])); }, []);

  const accountName = useMemo(() => {
    const names = Array.from(new Set(zones.map(z => z.account_name).filter(Boolean))) as string[];
    return names[0] ?? null;
  }, [zones]);

  return (
    <PageShell>
      <PageHeader title="Dashboard"
        subtitle={accountName ? `Connected to ${accountName}.` : 'Cloudflare Studio overview.'} />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Projects"      value={projects?.length ?? '—'} hint="Deployable workers + pages" />
          <Stat label="Zones"         value={zones.length}            hint="Cloudflare-managed domains" />
          <Stat label="Routes"        value={pages.length}            hint="Local hostnames via tunnel" />
          <Stat label="Tunnels"       value={tunnels.length}          hint="cloudflared tunnels known" />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel title="Connection">
            <PanelRow k="Token" v={hasToken ? 'configured' : 'missing'} ok={hasToken} />
            <PanelRow k="cloudflared" v={cloudflared?.version ?? '—'} ok={!!cloudflared} />
            <PanelRow k="Account" v={accountName ?? '—'} ok={!!accountName} />
          </Panel>

          <Panel title="Recent projects">
            {!projects || projects.length === 0 ? (
              <div className="text-[13px] text-fg-dim">No projects yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {projects.slice(0, 5).map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="text-fg truncate font-medium">{p.name}</span>
                    <span className="text-fg-dim truncate text-right font-mono text-[11px]">{p.deployedUrl ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
    </PageShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] border border-border-strong rounded-md px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">{label}</div>
      <div className="text-2xl font-semibold text-fg mt-1">{value}</div>
      <div className="text-[10px] text-fg-faint mt-1">{hint}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] border border-border-strong rounded-md p-4 space-y-2.5">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">{title}</div>
      {children}
    </div>
  );
}

function PanelRow({ k, v, ok }: { k: string; v: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-fg-muted">{k}</span>
      <span className={`${ok ? 'text-fg' : 'text-fg-dim'} font-medium`}>{v}</span>
    </div>
  );
}
