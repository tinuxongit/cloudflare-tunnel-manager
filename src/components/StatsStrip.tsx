import { useStore } from '@/lib/store';

export function StatsStrip() {
  const { pages, settings, statusByTunnel } = useStore();
  const active = pages.filter(p => p.enabled).length;
  const reqs = Object.values(statusByTunnel).reduce((acc, s) => acc + (s?.requests_per_s ?? 0), 0);
  const anyEdge = Object.values(statusByTunnel).find(s => s?.edge_region)?.edge_region ?? '—';

  return (
    <div className="grid grid-cols-4 border-b border-border-subtle bg-bg-elev">
      <Cell label="Active pages" value={`${active} / ${pages.length}`} sub={`${pages.length - active} disabled`} />
      <Cell label="Requests" value={`${reqs.toFixed(0)} /s`} sub="last poll" />
      <Cell label="Edge" value={anyEdge} sub={`${Object.keys(statusByTunnel).length} procs`} />
      <Cell label="Mode" value={settings?.grouping_mode ?? '…'} sub="grouping" />
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-6 py-5 border-r border-border-subtle last:border-r-0">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold mb-2">{label}</div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-[11px] font-mono text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
