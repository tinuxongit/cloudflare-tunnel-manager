import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import type { ServiceHealth } from '@/lib/types';

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
    <div>
      <div className="px-7 py-5 border-b border-border-subtle flex items-center justify-between">
        <h2 className="text-lg font-semibold">Local service health</h2>
        <button onClick={runAll} className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold">Recheck all</button>
      </div>
      <div className="p-4">
        {pages.map(p => {
          const r = results[p.id];
          return (
            <div key={p.id} className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3 border border-border-subtle rounded-lg mb-2">
              <div>
                <div className="text-sm font-medium">{p.hostname}</div>
                <div className="text-[11px] font-mono text-fg-muted">{p.service_url}</div>
              </div>
              <div className="text-[11px] font-mono">
                {r ? (r.reachable
                  ? <span className="text-fg">HTTP {r.http_status} · {r.latency_ms}ms</span>
                  : <span className="text-red-400">unreachable: {r.reason}</span>)
                  : <span className="text-fg-dim">checking…</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
