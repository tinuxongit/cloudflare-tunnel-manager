import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '@/lib/ipc';
import { useDeployTerminal } from '@/lib/deployTerminal';
import type { Project } from '@/lib/types';
import { ErrorBox } from '@/components/ListState';

export function ProjectEditor({ project, onClose, onChange }: {
  project: Project; onClose: () => void; onChange: () => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const original = useRef('');
  const startDeployTerminal = useDeployTerminal((s) => s.start);

  useEffect(() => { loadFiles(); }, [project.folder]);

  async function loadFiles() {
    setErr(null);
    try {
      const list = await api.listProjectFiles(project.folder);
      setFiles(list);
      // Open src/index.js by default if it's there.
      const preferred = list.find(f => f === 'src/index.js') ?? list.find(f => f.startsWith('src/')) ?? list[0];
      if (preferred) await openFile(preferred);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function openFile(rel: string) {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setErr(null);
    try {
      const body = await api.readProjectFile(project.folder, rel);
      original.current = body;
      setContent(body);
      setActiveFile(rel);
      setDirty(false);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  /** Returns true on success, false on failure. `err` is set in both cases. */
  async function save(): Promise<boolean> {
    if (!activeFile) return true;
    setSaving(true); setErr(null);
    try {
      await api.writeProjectFile(project.folder, activeFile, content);
      original.current = content;
      setDirty(false);
      return true;
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      return false;
    } finally { setSaving(false); }
  }

  async function deploy() {
    // Race-free: check save's return value, not stale React state.
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setDeploying(true);
    try {
      const eventId = await api.redeployProject(project.id);
      await startDeployTerminal(`Deploying ${project.name}`, eventId, () => {
        setDeploying(false);
        onChange();
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setDeploying(false);
    }
  }

  // Ctrl/Cmd + S to save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const grouped = groupByDir(files);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elev">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-xs text-fg-muted hover:text-fg">← Projects</button>
          <span className="font-mono text-sm text-fg">{project.name}</span>
          {activeFile && <span className="text-[11px] font-mono text-fg-dim">{activeFile}{dirty && <span className="text-yellow-300"> ●</span>}</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={!dirty || saving}
            className="text-[11px] px-3 py-1.5 border border-border rounded text-fg-muted hover:text-fg disabled:opacity-40">
            {saving ? 'Saving…' : 'Save (Ctrl+S)'}
          </button>
          <button onClick={deploy} disabled={deploying}
            className="text-[11px] px-3 py-1.5 bg-gradient-to-b from-fg to-fg-muted text-bg rounded font-semibold disabled:opacity-40">
            {deploying ? 'Deploying…' : 'Deploy'}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-[230px] border-r border-border overflow-y-auto p-2 bg-bg-elev/50">
          {Object.entries(grouped).map(([dir, items]) => (
            <div key={dir} className="mb-2">
              {dir && <div className="text-[10px] uppercase tracking-wider font-mono text-fg-dim px-2 py-1">{dir}</div>}
              {items.map(f => (
                <button key={f} onClick={() => openFile(f)}
                  className={`block w-full text-left px-2 py-1 rounded text-[11px] font-mono truncate ${activeFile === f ? 'bg-bg text-fg border border-border-strong' : 'text-fg-muted hover:text-fg hover:bg-bg'}`}>
                  {f.split('/').pop()}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">
          {err && <div className="p-3 border-b border-border"><ErrorBox text={err} /></div>}
          {activeFile ? (
            <div className="flex-1">
              <Editor
                height="100%"
                language={langFor(activeFile)}
                theme="vs-dark"
                value={content}
                onChange={(v) => { setContent(v ?? ''); setDirty((v ?? '') !== original.current); }}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  automaticLayout: true,
                }}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-fg-dim text-sm">Pick a file from the left.</div>
          )}
        </main>
      </div>
    </div>
  );
}

function groupByDir(files: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of files) {
    const i = f.lastIndexOf('/');
    const dir = i >= 0 ? f.slice(0, i) : '';
    (out[dir] ||= []).push(f);
  }
  return out;
}

function langFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'jsx') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'toml') return 'toml';
  if (ext === 'sql') return 'sql';
  if (ext === 'md') return 'markdown';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return 'plaintext';
}

