import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import type { PagesProject, PagesDeployment } from '@/lib/types';
import { TokenGate } from '@/components/TokenGate';
import { Loading, Empty, ErrorBox } from '@/components/ListState';
import { PageShell, PageHeader } from '@/components/PageShell';

export function CfPagesView() {
  const { hasToken } = useStore();
  const [projects, setProjects] = useState<PagesProject[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<PagesProject | null>(null);

  useEffect(() => { if (hasToken) load(); }, [hasToken]);

  async function load() {
    setErr(null);
    try { setProjects(await api.listPagesProjects()); }
    catch (e: any) { setErr(e?.message ?? String(e)); setProjects([]); }
  }

  if (!hasToken) return <TokenGate label="Pages" />;
  if (selected) return <ProjectDetail p={selected} onBack={() => setSelected(null)} />;

  return (
    <PageShell>
      <PageHeader title="Pages"
        subtitle="Static site hosting (Cloudflare Pages)."
        actions={
          <button onClick={load} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
            Refresh
          </button>
        } />

      {err && <ErrorBox text={err} />}

      {!projects ? <Loading label="Loading projects…" /> :
        projects.length === 0 ? <Empty label="No Pages projects yet." hint="Create one in the Cloudflare dashboard or via `wrangler pages project create`." /> : (
          <div className="grid grid-cols-1 gap-2">
            {projects.map(p => (
              <button key={p.name} onClick={() => setSelected(p)}
                className="text-left bg-bg-elev border border-border hover:border-border-strong rounded-md p-4">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm text-fg">{p.name}</div>
                  <div className="text-[10px] text-fg-dim font-mono">{p.production_branch ?? '—'}</div>
                </div>
                <div className="text-[11px] text-fg-dim mt-1 break-all">
                  {p.subdomain ?? '—'}
                  {p.domains && p.domains.length > 0 && ` · ${p.domains.length} custom domain${p.domains.length === 1 ? '' : 's'}`}
                </div>
              </button>
            ))}
          </div>
        )}
    </PageShell>
  );
}

function ProjectDetail({ p, onBack }: { p: PagesProject; onBack: () => void }) {
  const [deps, setDeps] = useState<PagesDeployment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listPagesDeployments(p.name)
      .then(setDeps)
      .catch((e: any) => { setErr(e?.message ?? String(e)); setDeps([]); });
  }, [p.name]);

  return (
    <div className="p-7 space-y-4">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-fg-muted hover:text-fg">← Projects</button>
        <h1 className="text-xl font-semibold font-mono">{p.name}</h1>
      </header>

      <div className="bg-bg-elev border border-border rounded-md p-4 text-sm space-y-2">
        <Row k="Subdomain" v={<a href={`https://${p.subdomain}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] hover:underline">{p.subdomain ?? '—'}</a>} />
        <Row k="Production branch" v={<span className="font-mono text-[11px]">{p.production_branch ?? '—'}</span>} />
        {p.domains && p.domains.length > 0 && (
          <Row k="Custom domains" v={<div className="text-right space-y-0.5">
            {p.domains.map(d => <div key={d} className="font-mono text-[11px]">{d}</div>)}
          </div>} />
        )}
      </div>

      <h2 className="text-sm font-semibold mt-6">Deployments</h2>

      {err && <ErrorBox text={err} />}

      {!deps ? <Loading label="Loading deployments…" /> :
        deps.length === 0 ? <Empty label="No deployments yet." /> : (
          <div className="bg-bg-elev border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg border-b border-border">
                <tr className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
                  <th className="text-left px-3 py-2 font-normal">Env</th>
                  <th className="text-left px-3 py-2 font-normal">Created</th>
                  <th className="text-left px-3 py-2 font-normal">Trigger</th>
                  <th className="text-left px-3 py-2 font-normal">URL</th>
                </tr>
              </thead>
              <tbody>
                {deps.map(d => (
                  <tr key={d.id} className="border-b border-border-subtle last:border-b-0">
                    <td className="px-3 py-2 font-mono text-[11px] text-fg">
                      <span className={d.environment === 'production' ? 'text-green-300' : 'text-fg-muted'}>
                        {d.environment}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">{new Date(d.created_on).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">{d.deployment_trigger ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-fg hover:underline break-all">{d.url}</a> : <span className="text-fg-dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-fg-dim">{k}</span>
      <span className="text-fg">{v}</span>
    </div>
  );
}
