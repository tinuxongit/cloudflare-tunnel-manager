import { useEffect, useRef } from 'react';
import { useDeployTerminal } from '@/lib/deployTerminal';
import type { ProjectProgress } from '@/lib/types';

/**
 * Slide-out terminal panel anchored bottom-right. Renders nothing when not
 * active. Subscribes to whatever event channel the latest `start()` opened.
 */
export function DeployTerminal() {
  const { open, label, events, done, error, close } = useDeployTerminal();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as lines stream in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events]);

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 w-[560px] max-w-[calc(100vw-2rem)] max-h-[60vh] bg-bg border border-border-strong rounded-lg shadow-2xl flex flex-col transition-all duration-200 ${
        open ? 'translate-x-0 opacity-100' : 'translate-x-[120%] opacity-0 pointer-events-none'
      }`}
      role="log"
      aria-live="polite"
    >
      <header className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-bg-elev rounded-t-lg">
        <div className="flex items-center gap-2 text-[12px] font-mono">
          <span className={`w-2 h-2 rounded-full ${
            error ? 'bg-red-400' : done ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
          }`} />
          <span className="text-fg">{label}</span>
          {done && !error && <span className="text-green-300">· done</span>}
          {error && <span className="text-red-300">· failed</span>}
        </div>
        <button onClick={close} className="text-fg-muted hover:text-fg text-lg leading-none px-1">×</button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 bg-[#0a0a0c] font-mono text-[11px] leading-relaxed">
        {events.length === 0 && <div className="text-fg-dim">Starting…</div>}
        <ul className="space-y-0.5">
          {events.map((e, i) => <li key={i}>{renderEvent(e)}</li>)}
        </ul>
      </div>
    </div>
  );
}

function renderEvent(e: ProjectProgress): React.ReactNode {
  switch (e.kind) {
    case 'step_start': return <span className="text-fg">▶ {e.label}</span>;
    case 'step_done':  return <span className="text-green-300">  ✓ {e.step.replace(/_/g, ' ')}</span>;
    case 'line':
      return (
        <span className={e.line.stream === 'stderr' ? 'text-yellow-200/80 pl-4' : 'text-fg-muted pl-4'}>
          {e.line.text}
        </span>
      );
    case 'success':
      return (
        <span className="text-green-300">
          ✓ Deployed{e.url ? <> → <a href={e.url} target="_blank" rel="noreferrer" className="underline hover:text-green-200">{e.url}</a></> : null}
        </span>
      );
    case 'error': return <span className="text-red-300">✗ {e.step}: {e.message}</span>;
  }
}
