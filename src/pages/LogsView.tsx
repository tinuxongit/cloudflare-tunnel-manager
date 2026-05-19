import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import type { LogLine } from '@/lib/types';

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
    <div className="flex flex-col h-screen">
      <div className="px-7 py-5 border-b border-border-subtle flex items-center justify-between">
        <h2 className="text-lg font-semibold">Logs</h2>
        <select value={selected} onChange={e => setSelected(e.target.value)}
          className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono">
          {tunnels.map(t => <option key={t.uuid} value={t.uuid}>{t.name}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-auto bg-bg-sunk font-mono text-[11px] p-3">
        {lines.length === 0
          ? <div className="text-fg-dim">No logs yet (tunnel not running?).</div>
          : lines.map((l, i) => (
              <div key={i} className={l.stream === 'stderr' ? 'text-red-300' : 'text-fg-muted'}>
                <span className="text-fg-faint mr-2">{new Date(l.ts_ms).toLocaleTimeString()}</span>{l.text}
              </div>
            ))}
      </div>
    </div>
  );
}
