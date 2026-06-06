import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/ipc';
import { streamWorkerTail, type Stop } from '@/lib/events';

type TailMsg =
  | { kind: 'request'; ts: number; method: string; url: string; status: number | null; outcome: string; logs: Array<{ level: string; message: string }>; exceptions: Array<{ name: string; message: string; stack?: string }> }
  | { kind: 'info'; text: string }
  | { kind: 'raw'; text: string };

export function TailViewer({ projectId, projectName, onClose }: { projectId: number; projectName: string; onClose: () => void }) {
  const [messages, setMessages] = useState<TailMsg[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tailId, setTailId] = useState<string | null>(null);
  const stopRef = useRef<Stop | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await api.startProjectTail(projectId);
        if (cancelled) { api.stopProjectTail(id).catch(() => {}); return; }
        setTailId(id);
        stopRef.current = await streamWorkerTail(id, (payload) => {
          setMessages(prev => [...prev, normalize(payload)]);
        });
      } catch (e: any) { setErr(e?.message ?? String(e)); }
    })();
    return () => {
      cancelled = true;
      if (stopRef.current) { try { Promise.resolve(stopRef.current()).catch(() => {}); } catch {} stopRef.current = null; }
      if (tailId) api.stopProjectTail(tailId).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  function clear() { setMessages([]); }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[820px] max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Live requests</h2>
            <p className="text-[11px] text-fg-dim mt-0.5 font-mono">{projectName}{tailId && <span className="text-green-300 ml-2">● connected</span>}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={clear} className="text-[11px] px-2 py-1 border border-border rounded text-fg-muted hover:text-fg">Clear</button>
            <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg">×</button>
          </div>
        </header>
        {err && <div className="px-6 py-3 text-[11px] font-mono text-red-300 bg-red-950/20 border-b border-red-900/50">{err}</div>}
        <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-[11px] p-4 space-y-1.5 bg-bg-elev/30">
          {messages.length === 0 && !err && (
            <div className="text-fg-dim">Waiting for requests… (trigger one in a browser or with the API tester)</div>
          )}
          {messages.map((m, i) => <MessageRow key={i} m={m} />)}
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m }: { m: TailMsg }) {
  if (m.kind === 'info') return <div className="text-fg-dim italic">▪ {m.text}</div>;
  if (m.kind === 'raw') return <div className="text-fg-muted">{m.text}</div>;

  const ts = new Date(m.ts).toLocaleTimeString();
  const statusColor =
    m.status == null ? 'text-fg-dim' :
    m.status < 300 ? 'text-green-300' :
    m.status < 400 ? 'text-yellow-300' :
    'text-red-300';

  return (
    <div className="border-l-2 border-border pl-3 py-1">
      <div className="flex gap-3 items-baseline">
        <span className="text-fg-dim">{ts}</span>
        <span className="text-fg">{m.method}</span>
        <span className={statusColor}>{m.status ?? '—'}</span>
        <span className="text-fg-muted break-all flex-1">{m.url}</span>
        {m.outcome !== 'ok' && <span className="text-red-300 uppercase">{m.outcome}</span>}
      </div>
      {m.logs.length > 0 && (
        <ul className="mt-1 pl-4 space-y-0.5">
          {m.logs.map((l, i) => (
            <li key={i} className={l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-yellow-300' : 'text-fg-muted'}>
              <span className="text-fg-dim uppercase mr-2">{l.level}</span>{l.message}
            </li>
          ))}
        </ul>
      )}
      {m.exceptions.length > 0 && (
        <ul className="mt-1 pl-4 space-y-0.5">
          {m.exceptions.map((e, i) => (
            <li key={i} className="text-red-300">
              {e.name}: {e.message}
              {e.stack && <pre className="text-[10px] text-red-300/70 mt-0.5 whitespace-pre-wrap">{e.stack}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function normalize(payload: any): TailMsg {
  if (payload?.info) return { kind: 'info', text: String(payload.info) };
  if (payload?.raw) return { kind: 'raw', text: String(payload.raw) };
  const req = payload?.event?.request;
  const resp = payload?.event?.response;
  return {
    kind: 'request',
    ts: payload?.eventTimestamp ?? Date.now(),
    method: req?.method ?? '?',
    url: req?.url ?? '',
    status: resp?.status ?? null,
    outcome: payload?.outcome ?? 'ok',
    logs: (payload?.logs ?? []).map((l: any) => ({
      level: l.level ?? 'log',
      message: Array.isArray(l.message) ? l.message.map(stringify).join(' ') : stringify(l.message),
    })),
    exceptions: (payload?.exceptions ?? []).map((e: any) => ({
      name: e.name ?? 'Error',
      message: e.message ?? '',
      stack: e.stack,
    })),
  };
}

function stringify(v: any): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
