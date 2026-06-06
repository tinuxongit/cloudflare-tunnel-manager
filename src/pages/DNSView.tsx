import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import type { DnsRecord } from '@/lib/types';
import { TokenGate } from '@/components/TokenGate';
import { Loading, Empty, ErrorBox } from '@/components/ListState';
import { PageShell, PageHeader } from '@/components/PageShell';
import { useConfirm } from '@/components/ConfirmDialog';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

export function DNSView() {
  const { hasToken, zones, refreshZones } = useStore();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const dnsTick = useStore((s) => s.dnsTick);
  useEffect(() => { if (hasToken && zones.length === 0) refreshZones(); }, [hasToken]);
  useEffect(() => { if (zoneId) loadRecords(); }, [zoneId, dnsTick]);
  useEffect(() => { if (zones.length > 0 && !zoneId) setZoneId(zones[0].id); }, [zones]);

  async function loadRecords() {
    if (!zoneId) return;
    setErr(null);
    try { setRecords(await api.listDnsRecords(zoneId)); }
    catch (e: any) { setErr(e?.message ?? String(e)); setRecords([]); }
  }

  if (!hasToken) return <TokenGate label="DNS" />;

  return (
    <PageShell>
      <PageHeader title="DNS"
        subtitle="Records across all your Cloudflare zones."
        actions={
          <>
            <select
              value={zoneId ?? ''}
              onChange={e => setZoneId(e.target.value || null)}
              className="h-9 bg-bg border border-border-strong rounded-md px-3 text-sm font-mono"
            >
              {zones.length === 0 && <option value="">(no zones)</option>}
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <button onClick={loadRecords} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              Refresh
            </button>
            <button onClick={() => setAdding(true)} disabled={!zoneId}
              className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset] disabled:opacity-40">
              + Add record
            </button>
          </>
        } />

      {err && <ErrorBox text={err} />}

      {zoneId && <CachePanel zoneId={zoneId} />}

      {!records ? <Loading label="Loading records…" /> :
        records.length === 0 ? <Empty label="No records in this zone yet." /> : (
          <div className="bg-bg-elev border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg border-b border-border">
                <tr className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
                  <th className="text-left px-3 py-2 font-normal">Type</th>
                  <th className="text-left px-3 py-2 font-normal">Name</th>
                  <th className="text-left px-3 py-2 font-normal">Content</th>
                  <th className="text-left px-3 py-2 font-normal">TTL</th>
                  <th className="text-left px-3 py-2 font-normal">Proxied</th>
                  <th className="text-right px-3 py-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <RecordRow key={r.id} r={r} zoneId={zoneId!} onChange={loadRecords} />
                ))}
              </tbody>
            </table>
          </div>
        )}

      {adding && zoneId && (
        <AddRecordDialog zoneId={zoneId} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); loadRecords(); }} />
      )}
    </PageShell>
  );
}

function CachePanel({ zoneId }: { zoneId: string }) {
  const [devMode, setDevMode] = useState<{ on: boolean; expiresAt: number | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  async function loadDevMode() {
    try { setDevMode(await api.getDevMode(zoneId)); }
    catch { setDevMode(null); }
  }

  useEffect(() => { loadDevMode(); }, [zoneId]);

  async function purge() {
    setBusy('purge'); setMsg(null);
    try {
      await api.purgeCache(zoneId);
      setMsg({ text: '✓ Cache purged. Visitors will fetch fresh content from origin.', tone: 'ok' });
    } catch (e: any) {
      setMsg({ text: e?.message ?? String(e), tone: 'err' });
    } finally { setBusy(null); }
  }

  async function toggleDev() {
    const next = !(devMode?.on ?? false);
    setBusy('dev'); setMsg(null);
    try {
      await api.setDevMode(zoneId, next);
      await loadDevMode();
      setMsg({
        text: next
          ? '✓ Development mode ON — caching bypassed for 3 hours.'
          : '✓ Development mode OFF — normal caching resumes.',
        tone: 'ok',
      });
    } catch (e: any) {
      setMsg({ text: e?.message ?? String(e), tone: 'err' });
    } finally { setBusy(null); }
  }

  const expiresIn =
    devMode?.on && devMode.expiresAt
      ? Math.max(0, Math.round((devMode.expiresAt - Date.now() / 1000) / 60))
      : null;

  return (
    <div className="bg-bg-elev border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs font-semibold text-fg">Edge cache</div>
          <div className="text-[11px] text-fg-dim mt-0.5 leading-relaxed">
            Cloudflare caches your site at the edge. Purge after pushing changes to make visitors
            see them immediately. Turn on Dev mode while iterating to bypass caching entirely.
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={purge}
            disabled={busy !== null}
            className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg disabled:opacity-40"
          >
            {busy === 'purge' ? 'Purging…' : 'Purge cache'}
          </button>
          <button
            onClick={toggleDev}
            disabled={busy !== null || devMode === null}
            className={`h-8 text-[11px] px-3 rounded-md font-semibold disabled:opacity-40 ${
              devMode?.on
                ? 'bg-yellow-600/80 hover:bg-yellow-600 text-bg'
                : 'border border-border-strong text-fg-muted hover:text-fg hover:bg-bg'
            }`}
          >
            {busy === 'dev'
              ? '…'
              : devMode === null
                ? 'Dev mode'
                : devMode.on
                  ? `Dev mode ON · ${expiresIn ?? '?'}m left`
                  : 'Dev mode OFF'}
          </button>
        </div>
      </div>
      {msg && (
        <div
          className={`text-[11px] font-mono rounded p-2 ${
            msg.tone === 'ok'
              ? 'text-green-300 bg-green-950/30 border border-green-900/50'
              : 'text-red-300 bg-red-950/30 border border-red-900/50'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

function RecordRow({ r, zoneId, onChange }: { r: DnsRecord; zoneId: string; onChange: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doDelete() {
    const ok = await confirm({
      title: `Delete ${r.type} record?`,
      message: `${r.name} → ${r.content}`,
      variant: 'danger',
      confirmLabel: 'Delete record',
    });
    if (!ok) return;
    setBusy(true); setErr(null);
    try { await api.deleteDnsRecord(zoneId, r.id); onChange(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <tr className="border-b border-border-subtle last:border-b-0 hover:bg-bg/40">
        <td className="px-3 py-2 font-mono text-[11px] text-fg">{r.type}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-fg">{r.name}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-fg-muted break-all max-w-[300px]">{r.content}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">{r.ttl === 1 ? 'auto' : r.ttl}</td>
        <td className="px-3 py-2 text-[11px]">{r.proxied ? <span className="text-orange-300">●</span> : <span className="text-fg-dim">○</span>}</td>
        <td className="px-3 py-2 text-right">
          <button onClick={doDelete} disabled={busy}
            className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-40">
            {busy ? '…' : 'Delete'}
          </button>
        </td>
      </tr>
      {err && (
        <tr><td colSpan={6} className="px-3 py-2"><ErrorBox text={err} /></td></tr>
      )}
    </>
  );
}

function AddRecordDialog({ zoneId, onClose, onAdded }: { zoneId: string; onClose: () => void; onAdded: () => void }) {
  const [type, setType] = useState('A');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [ttl, setTtl] = useState(1);
  const [proxied, setProxied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isProxyable = type === 'A' || type === 'AAAA' || type === 'CNAME';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createDnsRecord(zoneId, { type, name: name.trim(), content: content.trim(), ttl, proxied: isProxyable && proxied });
      onAdded();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-bg border border-border-strong rounded-lg w-[520px] p-6 space-y-3">
        <h2 className="text-lg font-semibold">Add DNS record</h2>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">Type</span>
          <select value={type} onChange={e => setType(e.target.value)}
            className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm">
            {RECORD_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} required spellCheck={false}
            placeholder="api  (use @ for root)"
            className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">Content</span>
          <input value={content} onChange={e => setContent(e.target.value)} required spellCheck={false}
            placeholder={type === 'A' ? '192.0.2.1' : type === 'CNAME' ? 'example.com' : ''}
            className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
        </label>

        <div className="flex gap-3">
          <label className="flex-1 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">TTL</span>
            <select value={ttl} onChange={e => setTtl(Number(e.target.value))}
              className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm">
              <option value={1}>Auto</option>
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={3600}>1 hour</option>
              <option value={86400}>1 day</option>
            </select>
          </label>
          {isProxyable && (
            <label className="flex-1 flex items-end pb-2 gap-2">
              <input type="checkbox" checked={proxied} onChange={e => setProxied(e.target.checked)} />
              <span className="text-sm">Proxied (orange cloud)</span>
            </label>
          )}
        </div>

        {err && <ErrorBox text={err} />}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
          <button type="submit" disabled={busy || !name || !content}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
            {busy ? 'Creating…' : 'Create record'}
          </button>
        </div>
      </form>
    </div>
  );
}
