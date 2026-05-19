import { useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import { StatsStrip } from '@/components/StatsStrip';
import { PageRow } from '@/components/PageRow';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AddPageDialog } from '@/components/AddPageDialog';
import type { Page } from '@/lib/types';

export function PagesView() {
  const { pages, statusByTunnel, refreshPages } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Page | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [globalError, setGlobalError] = useState<string | null>(null);
  useLiveStatus(true);

  function setBusy(id: number, busy: boolean) {
    setBusyIds(prev => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function toggle(id: number, on: boolean) {
    setBusy(id, true); setGlobalError(null);
    try {
      await api.togglePage(id, on);
      await refreshPages();              // reflect enabled flip immediately
      await api.startOrRestartForPage(id); // long step; status badge will follow
      await refreshPages();
    } catch (e: any) {
      setGlobalError(e?.message ?? String(e));
      await refreshPages();
    } finally {
      setBusy(id, false);
    }
  }

  async function remove(page: Page) {
    if (!confirm(`Delete ${page.hostname}? This stops routing through cloudflared but does NOT remove the DNS record from Cloudflare.`)) return;
    setBusy(page.id, true); setGlobalError(null);
    try {
      // First disable + restart so cloudflared stops serving this hostname
      if (page.enabled) {
        await api.togglePage(page.id, false);
        await api.startOrRestartForPage(page.id);
      }
      await api.deletePage(page.id);
      await refreshPages();
    } catch (e: any) {
      setGlobalError(e?.message ?? String(e));
    } finally {
      setBusy(page.id, false);
    }
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

      {globalError && (
        <div className="mx-4 mt-4 px-4 py-2 text-xs text-red-300 border border-red-700/40 bg-red-950/30 rounded-md font-mono">
          {globalError}
        </div>
      )}

      <div className="p-4">
        {pages.length === 0
          ? <div className="text-fg-dim text-sm p-6">No pages yet. Click "+ Add page" to create one.</div>
          : pages.map(p => (
              <PageRow key={p.id} page={p}
                status={statusByTunnel[p.tunnel_uuid]}
                busy={busyIds.has(p.id)}
                onToggle={(on) => toggle(p.id, on)}
                onEdit={() => setEditing(p)}
                onDelete={() => remove(p)} />
            ))}
      </div>
      <AddPageDialog open={adding} onClose={() => setAdding(false)} />
      <AddPageDialog open={editing !== null} onClose={() => setEditing(null)} editing={editing} />
    </div>
  );
}
