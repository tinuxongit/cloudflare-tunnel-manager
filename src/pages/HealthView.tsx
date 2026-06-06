import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import type { ServiceHealth } from '@/lib/types';
import { PageShell, PageHeader } from '@/components/PageShell';

export function HealthView() {
  const { pages } = useStore();
  const [results, setResults] = useState<Record<number, ServiceHealth>>({});

  async function runAll() {
    const out: Record<number, ServiceHealth> = {};
    await Promise.all(pages.map(async p => { out[p.id] = await api.checkLocalService(p.service_url); }));
    setResults(out);
  }

  useEffect(() => { runAll(); }, [pages]);

  return (
    <PageShell>
      <PageHeader title="Health"
        subtitle="Reachability of the local services behind your routes."
        actions={
          <button onClick={runAll} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
            Recheck all
          </button>
        } />

      {pages.length === 0 && <div className="text-fg-dim text-sm">No routes to check yet.</div>}
      <div className="space-y-2">
        {pages.map(p => {
          const r = results[p.id];
          return (
            <div key={p.id} className="grid grid-cols-[1fr_auto] gap-4 items-center px-4 py-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] border border-border-strong rounded-md">
              <div>
                <div className="text-sm font-medium">{p.hostname}</div>
                <div className="text-[11px] font-mono text-fg-muted">{p.service_url}</div>
              </div>
              <div className="text-[11px] font-mono">
                {r ? (r.reachable
                  ? <span className="text-green-300">HTTP {r.http_status} · {r.latency_ms}ms</span>
                  : <span className="text-red-400">unreachable: {r.reason}</span>)
                  : <span className="text-fg-dim">checking…</span>}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
