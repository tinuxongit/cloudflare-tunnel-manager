import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import type { Worker, WorkerScript, WorkerSecret } from '@/lib/types';
import { TokenGate } from '@/components/TokenGate';
import { PageShell, PageHeader } from '@/components/PageShell';
import { Loading, Empty, ErrorBox } from '@/components/ListState';
import { useConfirm } from '@/components/ConfirmDialog';

export function WorkersView() {
  const { hasToken } = useStore();
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Worker | null>(null);

  useEffect(() => { if (hasToken) load(); }, [hasToken]);

  async function load() {
    setErr(null);
    try { setWorkers(await api.listWorkers()); }
    catch (e: any) { setErr(e?.message ?? String(e)); setWorkers([]); }
  }

  if (!hasToken) return <TokenGate label="Workers" />;

  return (
    <PageShell>
      <PageHeader title="Workers"
        subtitle="Serverless functions deployed to Cloudflare's edge."
        actions={
          <button onClick={load} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
            Refresh
          </button>
        } />

      {err && <ErrorBox text={err} />}

      {!workers ? (
        <Loading label="Loading Workers…" />
      ) : workers.length === 0 ? (
        <Empty label="No Workers yet." hint="Deploy your first with `wrangler deploy` from a project folder." />
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {workers.map(w => (
            <WorkerRow key={w.id} w={w} active={selected?.id === w.id} onClick={() => setSelected(w)} />
          ))}
        </div>
      )}

      {selected && <WorkerDetail w={selected} onClose={() => setSelected(null)} onChange={load} />}
    </PageShell>
  );
}

function WorkerRow({ w, active, onClick }: { w: Worker; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-bg-elev border rounded-md p-4 transition ${
        active ? 'border-fg' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm text-fg">{w.id}</div>
        <div className="text-[10px] text-fg-dim font-mono">
          modified {new Date(w.modified_on).toLocaleString()}
        </div>
      </div>
    </button>
  );
}

function WorkerDetail({ w, onClose, onChange }: { w: Worker; onClose: () => void; onChange: () => void }) {
  const confirm = useConfirm();
  const [script, setScript] = useState<WorkerScript | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setScript(null);
    api.getWorker(w.id).then(setScript).catch((e: any) => setErr(e?.message ?? String(e)));
  }, [w.id]);

  async function doDelete() {
    const ok = await confirm({
      title: `Delete Worker "${w.id}"?`,
      message: 'Removes it from Cloudflare. Routes and custom domains pointing at it will 404.',
      variant: 'danger',
      confirmLabel: 'Delete Worker',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteWorker(w.id);
      onChange();
      onClose();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setDeleting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[640px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="font-mono text-sm">{w.id}</div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg leading-none">×</button>
        </header>
        <div className="p-6 space-y-4 text-sm">
          {err && <ErrorBox text={err} />}
          <Row k="Created" v={new Date(w.created_on).toLocaleString()} />
          <Row k="Modified" v={new Date(w.modified_on).toLocaleString()} />
          <Row k="Etag" v={<span className="font-mono text-[11px]">{w.etag}</span>} />
          {script && (
            <>
              <Row k="Compatibility date" v={<span className="font-mono text-[11px]">{script.compatibility_date || '—'}</span>} />
              <Row k="Usage model" v={<span className="font-mono text-[11px]">{script.usage_model || '—'}</span>} />
              <Row k="Logpush" v={<span className="font-mono text-[11px]">{script.logpush ? 'on' : 'off'}</span>} />
              <div className="pt-3 border-t border-border">
                <div className="text-fg-dim mb-2">Bindings</div>
                {script.bindings.length === 0 ? (
                  <div className="text-fg-dim text-[11px]">(none)</div>
                ) : (
                  <ul className="space-y-1">
                    {script.bindings.map((b, i) => (
                      <li key={i} className="flex justify-between gap-3 text-[11px] font-mono">
                        <span className="text-fg">{b.name}</span>
                        <span className="text-fg-muted">{b.kind}</span>
                        <span className="text-fg-dim truncate max-w-[200px]" title={b.target ?? ''}>
                          {b.target ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <SecretsPanel workerId={w.id} />
            </>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={doDelete} disabled={deleting}
            className="text-xs px-3 py-1.5 text-red-300 hover:text-red-200 disabled:opacity-40">
            {deleting ? 'Deleting…' : 'Delete Worker'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function SecretsPanel({ workerId }: { workerId: string }) {
  const confirm = useConfirm();
  const [secrets, setSecrets] = useState<WorkerSecret[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, [workerId]);

  async function load() {
    setErr(null);
    try { setSecrets(await api.listWorkerSecrets(workerId)); }
    catch (e: any) { setErr(e?.message ?? String(e)); setSecrets([]); }
  }
  async function save() {
    if (!newName.trim() || !newValue) return;
    setBusy(true); setErr(null);
    try {
      await api.putWorkerSecret(workerId, newName.trim().toUpperCase(), newValue);
      setNewName(''); setNewValue(''); setAdding(false);
      await load();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }
  async function del(name: string) {
    const ok = await confirm({
      title: `Delete secret ${name}?`,
      message: 'Anything reading it from env will start failing.',
      variant: 'danger',
      confirmLabel: 'Delete secret',
    });
    if (!ok) return;
    try { await api.deleteWorkerSecret(workerId, name); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  return (
    <div className="pt-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-fg-dim">Secrets</span>
        {!adding && <button onClick={() => setAdding(true)} className="text-[11px] text-fg-muted hover:text-fg">+ Add</button>}
      </div>

      {adding && (
        <div className="flex gap-1 mb-2">
          <input value={newName} onChange={e => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            placeholder="NAME" spellCheck={false}
            className="flex-1 bg-bg border border-border rounded px-2 py-1 font-mono text-[11px]" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} type="password"
            placeholder="value" spellCheck={false}
            className="flex-[2] bg-bg border border-border rounded px-2 py-1 font-mono text-[11px]" />
          <button onClick={save} disabled={busy || !newName || !newValue}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-2 text-[11px] font-semibold disabled:opacity-40">
            {busy ? '…' : 'Save'}
          </button>
          <button onClick={() => { setAdding(false); setNewName(''); setNewValue(''); }}
            className="text-fg-muted hover:text-fg text-[11px] px-1">×</button>
        </div>
      )}

      {err && <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-2 mb-2">{err}</div>}

      {!secrets ? (
        <div className="text-fg-dim text-[11px]">Loading…</div>
      ) : secrets.length === 0 ? (
        <div className="text-fg-dim text-[11px]">(none)</div>
      ) : (
        <ul className="space-y-1">
          {secrets.map(s => (
            <li key={s.name} className="flex justify-between items-center text-[11px] font-mono">
              <span className="text-fg">{s.name}</span>
              <span className="flex gap-2 items-center">
                <span className="text-fg-dim">●●●●●●</span>
                <button onClick={() => del(s.name)} className="text-red-300 hover:text-red-200">delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-fg-dim">{k}</span>
      <span className="text-fg text-right">{v}</span>
    </div>
  );
}

