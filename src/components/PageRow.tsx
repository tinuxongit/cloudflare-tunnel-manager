import { useEffect, useRef, useState } from 'react';
import type { Page, RuntimeStatus } from '@/lib/types';
import { StatusDot } from './StatusDot';

type Props = {
  page: Page;
  status: RuntimeStatus | undefined;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function PageRow({ page, status, busy, onToggle, onEdit, onDelete }: Props) {
  const on = page.enabled && status?.state === 'running';
  const stateLabel = busy
    ? 'working…'
    : on ? 'online'
    : page.enabled ? 'starting' : 'off';

  return (
    <div className={`grid grid-cols-[50px_1fr_130px_140px_90px_36px] gap-5 items-center px-4 py-4 rounded-xl border border-transparent transition relative
      ${busy ? 'opacity-70' : 'hover:bg-bg-elev hover:border-border-subtle'}`}>
      <button
        onClick={() => onToggle(!page.enabled)}
        disabled={busy}
        className={`w-9 h-5 rounded-full relative transition
          ${page.enabled
            ? 'bg-gradient-to-b from-fg to-fg-muted shadow-[0_0_12px_rgba(250,250,250,0.18)]'
            : 'bg-zinc-800 border border-zinc-700'}
          ${busy ? 'cursor-wait' : 'cursor-pointer'}`}>
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
        {busy
          ? <span className="w-3 h-3 border border-fg-muted border-t-transparent rounded-full animate-spin" />
          : <StatusDot state={on ? 'on' : 'off'} />}
        {stateLabel}
      </div>

      <div className="text-[11px] font-mono text-fg-muted">
        {status?.edge_region ? <><span className="text-fg">{status.edge_region}</span> · {status.connections ?? 0} conn</> : '—'}
      </div>

      <div className="text-base font-mono font-medium text-right">
        {status?.requests_per_s != null ? <>{status.requests_per_s.toFixed(0)}<span className="text-[10px] text-fg-dim">/s</span></> : '—'}
      </div>

      <RowMenu onEdit={onEdit} onDelete={onDelete} disabled={busy} />
    </div>
  );
}

function RowMenu({ onEdit, onDelete, disabled }: { onEdit: () => void; onDelete: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className="text-fg-faint hover:text-fg w-7 h-7 rounded-md hover:bg-bg-elev disabled:opacity-40"
      >⋯</button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-32 bg-bg-elev border border-border-strong rounded-md shadow-xl overflow-hidden">
          <MenuItem onClick={() => { setOpen(false); onEdit(); }}>Edit</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} danger>Delete</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-xs transition
        ${danger ? 'text-red-300 hover:bg-red-600/30 hover:text-red-200' : 'text-fg-muted hover:bg-zinc-800 hover:text-fg'}`}
    >{children}</button>
  );
}
