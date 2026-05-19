import type { Page, RuntimeStatus } from '@/lib/types';
import { StatusDot } from './StatusDot';

type Props = {
  page: Page;
  status: RuntimeStatus | undefined;
  onToggle: (on: boolean) => void;
};

export function PageRow({ page, status, onToggle }: Props) {
  const on = page.enabled && status?.state === 'running';
  return (
    <div className="grid grid-cols-[50px_1fr_130px_140px_90px_36px] gap-5 items-center px-4 py-4 rounded-xl border border-transparent hover:bg-bg-elev hover:border-border-subtle transition">
      <button onClick={() => onToggle(!page.enabled)}
        className={`w-9 h-5 rounded-full relative transition
          ${page.enabled
            ? 'bg-gradient-to-b from-fg to-fg-muted shadow-[0_0_12px_rgba(250,250,250,0.18)]'
            : 'bg-zinc-800 border border-zinc-700'}`}>
        <span className={`absolute top-[3px] w-3.5 h-3.5 rounded-full transition
          ${page.enabled ? 'right-[3px] bg-bg' : 'left-[3px] bg-fg-faint'}`} />
      </button>

      <div>
        <div className={`text-sm font-medium ${page.enabled ? 'text-fg' : 'text-fg-dim'}`}>{page.hostname}</div>
        <div className="text-[11px] font-mono text-fg-muted mt-1 flex items-center gap-2">
          {page.service_url} <span className="text-fg-faint">→</span> {page.hostname}
          <span className="px-1.5 py-0.5 text-[9px] uppercase border border-border-strong rounded bg-border">{page.tunnel_uuid.slice(0, 8)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-fg-muted">
        <StatusDot state={on ? 'on' : 'off'} /> {on ? 'online' : page.enabled ? 'starting' : 'off'}
      </div>

      <div className="text-[11px] font-mono text-fg-muted">
        {status?.edge_region ? <><span className="text-fg">{status.edge_region}</span> · {status.connections ?? 0} conn</> : '—'}
      </div>

      <div className="text-base font-mono font-medium text-right">
        {status?.requests_per_s != null ? <>{status.requests_per_s.toFixed(0)}<span className="text-[10px] text-fg-dim">/s</span></> : '—'}
      </div>

      <button className="text-fg-faint hover:text-fg w-7 h-7 rounded-md hover:bg-bg-elev">⋯</button>
    </div>
  );
}
