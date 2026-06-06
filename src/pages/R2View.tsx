import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import type { R2Bucket } from '@/lib/types';
import { TokenGate } from '@/components/TokenGate';
import { Loading, Empty, ErrorBox } from '@/components/ListState';
import { PageShell, PageHeader } from '@/components/PageShell';
import { useConfirm } from '@/components/ConfirmDialog';

function isAuthError(msg: string): boolean {
  // Cloudflare returns code 10000 + "Authentication error" + HTTP 403 when the
  // token is valid but lacks the resource permission. Distinct from 401 ("token
  // bad") and other 403s — match conservatively so we don't hide real failures.
  return /10000|authentication error|HTTP 403/i.test(msg);
}

function PermissionHint({ feature, perm }: { feature: string; perm: string }) {
  return (
    <div className="bg-[linear-gradient(180deg,rgba(234,179,8,0.08),rgba(234,179,8,0.02))] border border-yellow-700/40 rounded-md p-4 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-yellow-300 text-sm font-semibold">{feature} permission missing</span>
        <span className="text-[11px] font-mono text-fg-dim">HTTP 403 · code 10000</span>
      </div>
      <div className="text-[12px] text-fg-muted leading-relaxed">
        Your API token doesn't include <code className="font-mono text-fg bg-bg/60 border border-border rounded px-1.5 py-0.5">{perm}</code>.
        Recreate the token at <span className="font-mono text-fg-muted">Cloudflare → Profile → API Tokens</span>, add that
        permission row, and replace it in <span className="text-fg">Settings → Cloudflare access</span>.
      </div>
    </div>
  );
}

export function R2View() {
  const { hasToken } = useStore();
  const [buckets, setBuckets] = useState<R2Bucket[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const r2Tick = useStore((s) => s.r2Tick);
  useEffect(() => { if (hasToken) load(); }, [hasToken, r2Tick]);
  async function load() {
    setErr(null);
    try { setBuckets(await api.listR2Buckets()); }
    catch (e: any) { setErr(e?.message ?? String(e)); setBuckets([]); }
  }

  if (!hasToken) return <TokenGate label="R2" />;

  return (
    <PageShell>
      <PageHeader title="R2"
        subtitle="Object storage buckets. (Object-level upload/browse needs S3 keys — use wrangler or the dashboard for that.)"
        actions={
          <>
            <button onClick={load} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">Refresh</button>
            <button onClick={() => setAdding(true)} className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]">+ New bucket</button>
          </>
        } />

      {err && (isAuthError(err)
        ? <PermissionHint feature="R2" perm="Account > Workers R2 Storage > Edit" />
        : <ErrorBox text={err} />)}

      {!buckets ? <Loading label="Loading buckets…" /> :
        buckets.length === 0 ? <Empty label="No R2 buckets yet." /> : (
          <div className="grid grid-cols-1 gap-2">
            {buckets.map(b => <BucketCard key={b.name} b={b} onChange={load} />)}
          </div>
        )}

      {adding && <NewBucketDialog onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} />}
    </PageShell>
  );
}

function BucketCard({ b, onChange }: { b: R2Bucket; onChange: () => void }) {
  const confirm = useConfirm();
  async function del() {
    const ok = await confirm({
      title: `Delete bucket "${b.name}"?`,
      message: 'All objects in it are also deleted. This cannot be undone.',
      variant: 'danger',
      confirmLabel: 'Delete bucket',
    });
    if (!ok) return;
    try { await api.deleteR2Bucket(b.name); onChange(); } catch (e: any) { alert(e?.message ?? String(e)); }
  }
  return (
    <div className="bg-bg-elev border border-border rounded-md p-4 flex items-center justify-between">
      <div>
        <div className="font-mono text-sm text-fg">{b.name}</div>
        <div className="text-[11px] text-fg-dim font-mono mt-0.5">
          {b.location ?? 'auto'} · {b.storage_class ?? 'Standard'} · created {new Date(b.creation_date).toLocaleDateString()}
        </div>
      </div>
      <button onClick={del} className="text-[11px] text-red-300 hover:text-red-200">Delete</button>
    </div>
  );
}

function NewBucketDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api.createR2Bucket(name.trim()); onCreated(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-bg border border-border-strong rounded-lg w-[440px] p-6 space-y-3">
        <h2 className="text-base font-semibold">New R2 bucket</h2>
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">Name</span>
          <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            autoFocus spellCheck={false} placeholder="my-uploads"
            className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
          <span className="text-[11px] text-fg-dim">Lowercase letters, numbers, hyphens. 3–63 characters.</span>
        </label>
        {err && <ErrorBox text={err} />}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
          <button type="submit" disabled={busy || name.length < 3}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
