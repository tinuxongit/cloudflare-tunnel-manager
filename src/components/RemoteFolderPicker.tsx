import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import type { BrowseResult, FsEntry } from '@/lib/types';

/**
 * Remote folder picker. Calls the connector's `/fs/browse` to list a folder
 * on the server, lets the user navigate, then returns the picked path.
 * Also used in local mode as a uniform UX (no need to context-switch the
 * native dialog when you're already pointing at a remote machine).
 */
export function RemoteFolderPicker({
  title = 'Pick a folder',
  initialPath,
  onPick,
  onClose,
}: {
  title?: string;
  initialPath?: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typedPath, setTypedPath] = useState('');

  async function load(path: string | null) {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.browseFs(path);
      setData(r);
      setTypedPath(r.path);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(initialPath ?? null); }, []);

  function go(entry: FsEntry) {
    if (!entry.isDir) return;
    load(entry.path);
  }

  function up() {
    if (data?.parent) load(data.parent);
  }

  function pickHere() {
    if (data) onPick(data.path);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[640px] max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg leading-none px-1">×</button>
        </header>

        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={up} disabled={!data?.parent}
              className="h-8 px-2 text-[11px] border border-border rounded text-fg-muted hover:text-fg disabled:opacity-40">↑ Up</button>
            <input
              value={typedPath}
              onChange={(e) => setTypedPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(typedPath); }}
              spellCheck={false}
              placeholder="/home/user/projects"
              className="flex-1 bg-bg-elev border border-border rounded px-3 py-1.5 font-mono text-[12px]" />
            <button onClick={() => load(typedPath)}
              className="h-8 px-2 text-[11px] border border-border rounded text-fg-muted hover:text-fg">Go</button>
          </div>
          {data?.roots.length ? (
            <div className="flex gap-1 flex-wrap">
              {data.roots.map((r) => (
                <button key={r} onClick={() => load(r)}
                  className="text-[11px] px-2 py-0.5 border border-border rounded text-fg-muted hover:text-fg font-mono">
                  {r}
                </button>
              ))}
              {data.home && (
                <button onClick={() => load(data.home)}
                  className="text-[11px] px-2 py-0.5 border border-border rounded text-fg-muted hover:text-fg font-mono">
                  ~ home
                </button>
              )}
            </div>
          ) : null}
        </div>

        {err && <div className="px-5 py-2 text-[11px] font-mono text-red-300 bg-red-950/20 border-b border-red-900/50">{err}</div>}

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-fg-dim text-sm">Loading…</div>}
          {!loading && data && (
            <ul className="divide-y divide-border">
              {data.entries.length === 0 && (
                <li className="px-5 py-4 text-fg-dim text-[12px]">Empty folder.</li>
              )}
              {data.entries.map((e) => (
                <li key={e.path}>
                  <button onClick={() => go(e)} disabled={!e.isDir}
                    className={`w-full text-left px-5 py-2 flex items-center gap-2 text-[12px] ${
                      e.isDir ? 'text-fg hover:bg-bg-elev' : 'text-fg-dim'
                    }`}>
                    <span className="w-4">{e.isDir ? '📁' : '📄'}</span>
                    <span className="font-mono truncate">{e.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border flex items-center justify-between bg-bg-elev/40">
          <div className="text-[11px] text-fg-dim font-mono truncate flex-1 mr-3" title={data?.path}>
            {data?.path}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="h-8 px-3 text-[11px] border border-border rounded text-fg-muted hover:text-fg">Cancel</button>
            <button onClick={pickHere} disabled={!data}
              className="h-8 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded px-3 text-[11px] font-semibold disabled:opacity-40">
              Pick this folder
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
