import { useState } from 'react';
import { api } from '@/lib/ipc';
import type { HttpResponse } from '@/lib/types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

export function ApiTester({ defaultUrl }: { defaultUrl: string }) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState(defaultUrl);
  const [headers, setHeaders] = useState<Array<[string, string]>>([['Content-Type', 'application/json']]);
  const [body, setBody] = useState('');
  const [resp, setResp] = useState<HttpResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allowsBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  async function send() {
    setBusy(true); setErr(null); setResp(null);
    try {
      const headersObj = Object.fromEntries(headers.filter(([k]) => k.trim()));
      const r = await api.httpRequest({ method, url, headers: headersObj, body: allowsBody ? body : null });
      setResp(r);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  function updateHeader(i: number, k: string, v: string) {
    setHeaders(h => h.map((row, idx) => idx === i ? [k, v] : row));
  }
  function addHeader() { setHeaders(h => [...h, ['', '']]); }
  function removeHeader(i: number) { setHeaders(h => h.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="bg-bg border border-border rounded px-3 py-2 font-mono text-sm">
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
        <input value={url} onChange={e => setUrl(e.target.value)} spellCheck={false}
          className="flex-1 bg-bg border border-border rounded px-3 py-2 font-mono text-sm" />
        <button onClick={send} disabled={busy || !url}
          className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-4 py-2 text-xs font-semibold disabled:opacity-40">
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      <details className="bg-bg border border-border rounded">
        <summary className="px-3 py-2 cursor-pointer text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
          Headers ({headers.filter(([k]) => k.trim()).length})
        </summary>
        <div className="p-3 space-y-1 border-t border-border">
          {headers.map((row, i) => (
            <div key={i} className="flex gap-1">
              <input value={row[0]} onChange={e => updateHeader(i, e.target.value, row[1])} placeholder="key"
                spellCheck={false} className="flex-1 bg-bg-elev border border-border rounded px-2 py-1 font-mono text-[11px]" />
              <input value={row[1]} onChange={e => updateHeader(i, row[0], e.target.value)} placeholder="value"
                spellCheck={false} className="flex-[2] bg-bg-elev border border-border rounded px-2 py-1 font-mono text-[11px]" />
              <button onClick={() => removeHeader(i)} className="px-2 text-red-300 hover:text-red-200 text-xs">×</button>
            </div>
          ))}
          <button onClick={addHeader} className="text-[11px] text-fg-muted hover:text-fg">+ Add header</button>
        </div>
      </details>

      {allowsBody && (
        <details open className="bg-bg border border-border rounded">
          <summary className="px-3 py-2 cursor-pointer text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
            Body
          </summary>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} spellCheck={false}
            placeholder='{ "key": "value" }'
            className="w-full bg-bg-elev border-0 border-t border-border px-3 py-2 font-mono text-[11px] resize-y focus:outline-none" />
        </details>
      )}

      {err && <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-3 break-words">{err}</div>}

      {resp && (
        <div className="bg-bg border border-border rounded">
          <div className="px-3 py-2 border-b border-border flex items-center gap-3 text-[11px] font-mono">
            <span className={statusColor(resp.status)}>{resp.status}</span>
            <span className="text-fg-dim">{resp.latencyMs}ms</span>
            <span className="text-fg-dim">{resp.body.length} bytes</span>
          </div>
          <details className="border-b border-border">
            <summary className="px-3 py-2 cursor-pointer text-[11px] uppercase tracking-wider text-fg-muted font-semibold">Headers</summary>
            <div className="px-3 py-2 font-mono text-[11px] space-y-0.5">
              {resp.headers.map(([k, v], i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-fg-muted">{k}:</span>
                  <span className="text-fg break-all">{v}</span>
                </div>
              ))}
            </div>
          </details>
          <pre className="px-3 py-3 font-mono text-[11px] text-fg overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
{tryPrettyJson(resp.body)}
          </pre>
        </div>
      )}
    </div>
  );
}

function statusColor(s: number): string {
  if (s >= 200 && s < 300) return 'text-green-300';
  if (s >= 300 && s < 400) return 'text-yellow-300';
  if (s >= 400) return 'text-red-300';
  return 'text-fg';
}
function tryPrettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
