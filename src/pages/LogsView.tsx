import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import type { LogLine } from '@/lib/types';
import { PageShell, PageHeader } from '@/components/PageShell';

export function LogsView() {
  const { tunnels } = useStore();
  const [selected, setSelected] = useState<string>('');
  const [lines, setLines] = useState<LogLine[]>([]);

  useEffect(() => {
    if (!selected && tunnels[0]) setSelected(tunnels[0].uuid);
  }, [tunnels, selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function tick() {
      const ls = await api.getLogs(selected, 500).catch(() => []);
      if (!cancelled) setLines(ls);
    }
    tick();
    const id = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(id); };
  }, [selected]);

  return (
    <PageShell>
      <PageHeader title="Logs"
        subtitle="cloudflared output for the selected tunnel."
        actions={
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="h-9 bg-bg border border-border-strong rounded-md px-3 text-sm font-mono">
            {tunnels.length === 0 && <option value="">(no tunnels)</option>}
            {tunnels.map(t => <option key={t.uuid} value={t.uuid}>{t.name}</option>)}
          </select>
        } />

      <div className="bg-bg-sunk border border-border-strong rounded-md font-mono text-[11px] p-3 h-[calc(100vh-240px)] overflow-auto">
        {lines.length === 0
          ? <div className="text-fg-dim">No logs yet (tunnel not running?).</div>
          : lines.map((l, i) => (
              <div key={i} className={l.stream === 'stderr' ? 'text-red-300' : 'text-fg-muted'}>
                <span className="text-fg-faint mr-2">{new Date(l.ts_ms).toLocaleTimeString()}</span>{l.text}
              </div>
            ))}
      </div>
    </PageShell>
  );
}
