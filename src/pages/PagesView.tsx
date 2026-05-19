import { useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import { StatsStrip } from '@/components/StatsStrip';
import { PageRow } from '@/components/PageRow';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AddPageDialog } from '@/components/AddPageDialog';

export function PagesView() {
  const { pages, statusByTunnel, refreshPages } = useStore();
  const [adding, setAdding] = useState(false);
  useLiveStatus(true);

  async function toggle(id: number, on: boolean) {
    await api.togglePage(id, on);
    await api.startOrRestartForPage(id);
    await refreshPages();
  }

  return (
    <div>
      <div className="px-7 py-5 border-b border-border-subtle bg-bg-elev/70 backdrop-blur flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Pages</h2>
          <div className="text-[11px] text-fg-dim font-mono mt-1">workspace / pages</div>
        </div>
        <button onClick={() => setAdding(true)} className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-xs font-semibold shadow">+ Add page</button>
      </div>

      <StatsStrip />

      <div className="p-4">
        {pages.length === 0
          ? <div className="text-fg-dim text-sm p-6">No pages yet. Click "+ Add page" to create one.</div>
          : pages.map(p => (
              <PageRow key={p.id} page={p}
                status={statusByTunnel[p.tunnel_uuid]}
                onToggle={(on) => toggle(p.id, on)} />
            ))}
      </div>
      <AddPageDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
