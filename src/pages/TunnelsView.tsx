import { useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';
import { PageShell, PageHeader } from '@/components/PageShell';
import { useConfirm } from '@/components/ConfirmDialog';

export function TunnelsView() {
  const { tunnels, refreshTunnels } = useStore();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    setRefreshing(true); setErr(null);
    try { await refreshTunnels(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setRefreshing(false); }
  }

  async function create() {
    setBusy(true); setErr(null);
    try { await api.createTunnel(name); setName(''); await refreshTunnels(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function remove(uuid: string) {
    const ok = await confirm({
      title: 'Delete tunnel?',
      message: `${uuid}\n\nThis cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete tunnel',
    });
    if (!ok) return;
    await api.deleteTunnel(uuid);
    await refreshTunnels();
  }

  return (
    <PageShell>
      <PageHeader title="Tunnels"
        subtitle="cloudflared tunnels available on this account."
        actions={
          <>
            <button onClick={reload} disabled={refreshing}
              className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition disabled:opacity-40 flex items-center gap-1.5">
              {refreshing && <span className="w-3 h-3 border border-fg-muted border-t-transparent rounded-full animate-spin" />}
              ↻ Refresh
            </button>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="new tunnel name"
              className="h-9 bg-bg border border-border-strong rounded-md px-3 text-sm font-mono" />
            <button disabled={!name || busy} onClick={create}
              className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset] disabled:opacity-40">
              + Create
            </button>
          </>
        } />

      {err && (
        <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-3 whitespace-pre-wrap">
          {err}
        </div>
      )}

      <div className="space-y-2">
        {tunnels.length === 0 && !err && <div className="text-fg-dim text-sm">No tunnels yet.</div>}
        {tunnels.map(t => (
          <div key={t.uuid} className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] border border-border-strong rounded-md">
            <div>
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-[11px] font-mono text-fg-muted">{t.uuid}</div>
            </div>
            {t.managed && <span className="text-[10px] uppercase font-mono text-fg-dim border border-border rounded px-2 py-0.5">managed</span>}
            <button onClick={() => remove(t.uuid)} className="text-fg-muted text-xs hover:text-red-400">Delete</button>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
