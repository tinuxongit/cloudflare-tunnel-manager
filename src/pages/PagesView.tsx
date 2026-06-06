import { useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import { StatsStrip } from '@/components/StatsStrip';
import { PageRow } from '@/components/PageRow';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AddPageDialog } from '@/components/AddPageDialog';
import type { Page } from '@/lib/types';
import { PageShell, PageHeader } from '@/components/PageShell';
import { useConfirm } from '@/components/ConfirmDialog';
import { LocalLogsViewer } from '@/components/LocalLogsViewer';

export function PagesView() {
  const { pages, statusByTunnel, refreshPages } = useStore();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Page | null>(null);
  const [logsFor, setLogsFor] = useState<Page | null>(null);
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
    const ok = await confirm({
      title: `Delete route ${page.hostname}?`,
      message: 'Stops routing through cloudflared but does NOT remove the DNS record from Cloudflare.',
      variant: 'danger',
      confirmLabel: 'Delete route',
    });
    if (!ok) return;
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
    <PageShell>
      <PageHeader title="Routes"
        subtitle="hostname → local service via tunnel"
        actions={
          <>
            <button onClick={refreshPages}
              className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              ↻ Refresh
            </button>
            <button onClick={() => setAdding(true)} className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]">
              + Add route
            </button>
          </>
        } />

      <StatsStrip />

      {globalError && (
        <div className="px-4 py-2 text-xs text-red-300 border border-red-700/40 bg-red-950/30 rounded-md font-mono">
          {globalError}
        </div>
      )}

      {pages.length === 0
        ? <div className="text-fg-dim text-sm">No routes yet. Click "+ Add route" to create one.</div>
        : <div className="space-y-2">
            {pages.map(p => (
              <PageRow key={p.id} page={p}
                status={statusByTunnel[p.tunnel_uuid]}
                busy={busyIds.has(p.id)}
                onToggle={(on) => toggle(p.id, on)}
                onEdit={() => setEditing(p)}
                onDelete={() => remove(p)}
                onViewLogs={() => setLogsFor(p)} />
            ))}
          </div>}

      <AddPageDialog open={adding} onClose={() => setAdding(false)} />
      <AddPageDialog open={editing !== null} onClose={() => setEditing(null)} editing={editing} />
      {logsFor && (
        <LocalLogsViewer
          pageId={logsFor.id}
          hostname={logsFor.hostname}
          onClose={() => setLogsFor(null)} />
      )}
    </PageShell>
  );
}
