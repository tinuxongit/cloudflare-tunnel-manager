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
  onViewLogs: () => void;
};

export function PageRow({ page, status, busy, onToggle, onEdit, onDelete, onViewLogs }: Props) {
  const on = page.enabled && status?.state === 'running';
  const errored = page.enabled && status?.state === 'error';
  const starting = page.enabled && !on && !errored;
  const dotState: 'on' | 'off' | 'starting' | 'error' =
    on ? 'on' : errored ? 'error' : starting ? 'starting' : 'off';
  const stateLabel = busy
    ? 'working…'
    : on ? 'online'
    : errored ? 'error — check logs'
    : starting ? 'starting'
    : 'off';

  return (
    <div className={`grid grid-cols-[50px_1fr_130px_140px_90px_auto_36px] gap-5 items-center px-4 py-4 rounded-xl border border-transparent transition relative
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

      <div className="min-w-0">
        <div className={`text-sm font-medium ${page.enabled ? 'text-fg' : 'text-fg-dim'}`}>{page.hostname}</div>
        <div className="text-[11px] font-mono text-fg-muted mt-1 flex items-center gap-2 truncate">
          <span className="truncate">{page.service_url} <span className="text-fg-faint">→</span> {page.hostname}</span>
          <span className="px-1.5 py-0.5 text-[9px] uppercase border border-border-strong rounded bg-border shrink-0">{page.tunnel_uuid.slice(0, 8)}</span>
        </div>
      </div>

      <div className={`flex items-center gap-2 text-[11px] font-medium
        ${errored ? 'text-red-400' : 'text-fg-muted'}`}>
        {busy
          ? <span className="w-3 h-3 border border-fg-muted border-t-transparent rounded-full animate-spin" />
          : <StatusDot state={dotState} />}
        {stateLabel}
      </div>

      <div className="text-[11px] font-mono text-fg-muted">
        {status?.edge_region ? <><span className="text-fg">{status.edge_region}</span> · {status.connections ?? 0} conn</> : '—'}
      </div>

      <div className="text-base font-mono font-medium text-right">
        {status?.requests_per_s != null ? <>{status.requests_per_s.toFixed(0)}<span className="text-[10px] text-fg-dim">/s</span></> : '—'}
      </div>

      <button
        onClick={onViewLogs}
        disabled={busy}
        title="Console / logs"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full text-fg-muted bg-bg/60 border border-border-strong hover:text-fg hover:bg-bg-elev hover:border-zinc-600 transition disabled:opacity-40">
        <IconTerminal />
        Logs
      </button>

      <RowMenu onEdit={onEdit} onDelete={onDelete} onViewLogs={onViewLogs} disabled={busy} />
    </div>
  );
}

function RowMenu({ onEdit, onDelete, onViewLogs, disabled }: {
  onEdit: () => void; onDelete: () => void; onViewLogs: () => void; disabled: boolean;
}) {
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
        aria-label="More actions"
        title="More actions"
        className="h-9 w-9 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev border border-border-strong transition disabled:opacity-40">
        <IconMore />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-[200px] bg-bg border border-border-strong rounded-md shadow-xl py-1">
          <MenuItem icon={<IconTerminal />} onClick={() => { setOpen(false); onViewLogs(); }}>View logs</MenuItem>
          <MenuItem icon={<IconPencil />}   onClick={() => { setOpen(false); onEdit(); }}>Edit route</MenuItem>
          <div className="border-t border-border my-1" />
          <MenuItem icon={<IconTrash />}    onClick={() => { setOpen(false); onDelete(); }} danger>Delete route</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children, danger, icon }: {
  onClick: () => void; children: React.ReactNode; danger?: boolean; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] transition
        ${danger ? 'text-red-300 hover:bg-red-950/30' : 'text-fg-muted hover:bg-bg-elev hover:text-fg'}`}>
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

// ── icons ───────────────────────────────────────────────────────────────

function IconMore() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
    </svg>
  );
}
function IconTerminal() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}
function IconPencil() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  );
}
