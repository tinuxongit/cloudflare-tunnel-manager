import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/ipc';
import type { LogLine } from '@/lib/types';

// Tails a Route's spawned local process (stdout + stderr). Polls
// api.getLocalLogs every 1s — the backend keeps a ring buffer per page so
// catch-up after reconnect is cheap. Distinct from TailViewer which streams
// Workers tail events for projects deployed to Cloudflare.

export function LocalLogsViewer({
  pageId, hostname, onClose,
}: {
  pageId: number;
  hostname: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      if (cancelled || paused) return;
      try {
        const ls = await api.getLocalLogs(pageId, 1000);
        if (!cancelled) { setLines(ls); setErr(null); setStreaming(true); }
      } catch (e: any) {
        if (!cancelled) { setErr(e?.message ?? String(e)); setStreaming(false); }
      }
    }

    tick();
    timer = window.setInterval(tick, 1000);
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, [pageId, paused]);

  // Auto-scroll to bottom on new lines (unless user is paused = wants to read).
  useEffect(() => {
    if (paused) return;
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, paused]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[linear-gradient(180deg,#111217,#0b0c10)] border border-border-strong rounded-md w-[820px] max-h-[85vh] overflow-hidden flex flex-col shadow-[0_28px_120px_rgba(0,0,0,0.65)]" onClick={e => e.stopPropagation()}>
        <header className="px-6 pt-5 pb-4 flex items-start justify-between gap-4 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full border border-zinc-600 bg-bg-elev flex items-center justify-center text-fg-muted">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
              </span>
              <h2 className="text-lg font-semibold tracking-tight">Console</h2>
              <span className={`text-[11px] font-medium ${streaming ? 'text-green-300' : 'text-yellow-300'}`}>
                {streaming ? '● live' : '● disconnected'}
              </span>
            </div>
            <p className="text-[12px] text-fg-muted mt-1 font-mono truncate" title={hostname}>{hostname}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setPaused(p => !p)}
              className="h-8 px-3 text-[11px] border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={() => setLines([])}
              className="h-8 px-3 text-[11px] border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              Clear
            </button>
            <button onClick={onClose} aria-label="Close"
              className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </header>

        {err && (
          <div className="px-6 py-2 text-[11px] font-mono text-red-300 bg-red-950/20 border-b border-red-900/50">
            {err}
          </div>
        )}

        <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-[11px] p-4 bg-bg-sunk/60">
          {lines.length === 0 ? (
            <div className="text-fg-dim">No output yet. If the process just started, give it a second; if it crashed, check the route's status badge.</div>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={l.stream === 'stderr' ? 'text-red-300' : 'text-fg-muted'}>
                <span className="text-fg-faint mr-3">{new Date(l.ts_ms).toLocaleTimeString()}</span>
                {l.text}
              </div>
            ))
          )}
        </div>

        <footer className="px-6 py-2 border-t border-border text-[11px] font-mono text-fg-dim flex items-center justify-between">
          <span>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          <span>polling every 1s · last 1000 lines</span>
        </footer>
      </div>
    </div>
  );
}
