import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc';
import { useStore } from '@/lib/store';
import type { D1Database, D1QueryResult } from '@/lib/types';
import { TokenGate } from '@/components/TokenGate';
import { Loading, Empty, ErrorBox } from '@/components/ListState';
import { PageShell, PageHeader } from '@/components/PageShell';
import { useConfirm } from '@/components/ConfirmDialog';

export function D1View() {
  const { hasToken } = useStore();
  const confirm = useConfirm();
  const [dbs, setDbs] = useState<D1Database[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<D1Database | null>(null);

  const d1Tick = useStore((s) => s.d1Tick);
  useEffect(() => { if (hasToken) load(); }, [hasToken, d1Tick]);
  async function load() {
    setErr(null);
    try { setDbs(await api.listD1Databases()); }
    catch (e: any) { setErr(e?.message ?? String(e)); setDbs([]); }
  }

  async function del(d: D1Database) {
    const ok = await confirm({
      title: `Delete D1 database "${d.name}"?`,
      message: 'All data is wiped permanently. This cannot be undone.',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try { await api.deleteD1Database(d.uuid); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  if (!hasToken) return <TokenGate label="D1" />;
  if (selected) return <D1Detail db={selected} onBack={() => setSelected(null)} />;

  return (
    <PageShell>
      <PageHeader title="D1"
        subtitle="SQLite-on-the-edge databases."
        actions={
          <button onClick={load} className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
            Refresh
          </button>
        } />

      {err && <ErrorBox text={err} />}

      {!dbs ? <Loading label="Loading databases…" /> :
        dbs.length === 0 ? <Empty label="No D1 databases yet." hint="Create one via the New Project wizard, or `wrangler d1 create <name>`." /> : (
          <div className="grid grid-cols-1 gap-2">
            {dbs.map(d => (
              <div key={d.uuid}
                onClick={() => setSelected(d)}
                className="text-left bg-bg-elev border border-border hover:border-border-strong rounded-md p-4 cursor-pointer transition">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-sm text-fg">{d.name}</div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-[10px] text-fg-dim font-mono">{d.uuid}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); del(d); }}
                      title={`Delete ${d.name} from Cloudflare`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full text-red-300 bg-red-500/10 border border-red-500/30 hover:text-red-200 hover:bg-red-500/20 hover:border-red-500/50 transition">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                      Delete
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-fg-dim mt-1">
                  v{d.version} · {d.file_size != null ? formatBytes(d.file_size) : '—'} ·
                  created {new Date(d.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
    </PageShell>
  );
}

function D1Detail({ db, onBack }: { db: D1Database; onBack: () => void }) {
  const [tab, setTab] = useState<'tables' | 'sql'>('tables');
  return (
    <div className="p-7 space-y-4">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-fg-muted hover:text-fg">← Databases</button>
        <h1 className="text-xl font-semibold font-mono">{db.name}</h1>
        <span className="text-[10px] font-mono text-fg-dim">{db.uuid}</span>
      </header>
      <div className="flex gap-1 border-b border-border">
        <TabBtn active={tab === 'tables'} onClick={() => setTab('tables')}>Tables</TabBtn>
        <TabBtn active={tab === 'sql'} onClick={() => setTab('sql')}>SQL</TabBtn>
      </div>
      {tab === 'tables' && <TablesTab db={db} />}
      {tab === 'sql' && <SqlConsole db={db} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition ${active
        ? 'border-fg text-fg'
        : 'border-transparent text-fg-muted hover:text-fg'}`}>
      {children}
    </button>
  );
}

// ── Tables tab — visual browse + edit ───────────────────────────────────

type ColumnInfo = { cid: number; name: string; type: string; notnull: number; pk: number };

function TablesTab({ db }: { db: D1Database }) {
  const [tables, setTables] = useState<string[] | null>(null);
  const [tableErr, setTableErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => { loadTables(); }, [db.uuid]);
  async function loadTables() {
    setTableErr(null);
    try {
      const r = await api.execD1(db.uuid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
      const list = (r.results ?? []).map((row: any) => String(row.name));
      setTables(list);
      if (list.length > 0 && !active) setActive(list[0]);
    } catch (e: any) { setTableErr(e?.message ?? String(e)); setTables([]); }
  }

  if (tableErr) return <ErrorBox text={tableErr} />;
  if (!tables) return <Loading label="Loading tables…" />;
  if (tables.length === 0) return <Empty label="No tables yet." hint='Run `CREATE TABLE …` in the SQL tab to make one.' />;

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <aside className="space-y-1">
        {tables.map(t => (
          <button key={t} onClick={() => setActive(t)}
            className={`w-full text-left px-3 py-1.5 rounded font-mono text-[11px] ${active === t ? 'bg-bg-elev text-fg border border-border-strong' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}>
            {t}
          </button>
        ))}
      </aside>
      <main className="min-w-0">{active && <TableBrowser db={db} tableName={active} />}</main>
    </div>
  );
}

function TableBrowser({ db, tableName }: { db: D1Database; tableName: string }) {
  const confirm = useConfirm();
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string; value: string } | null>(null);

  useEffect(() => { reload(); setEditingCell(null); }, [tableName]);

  async function reload() {
    setErr(null);
    try {
      const colR = await api.execD1(db.uuid, `PRAGMA table_info("${tableName}")`);
      const cols = (colR.results ?? []) as ColumnInfo[];
      setColumns(cols);
      const rowR = await api.execD1(db.uuid, `SELECT rowid AS __rowid, * FROM "${tableName}" ORDER BY rowid DESC LIMIT 200`);
      setRows((rowR.results ?? []) as Record<string, any>[]);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function commitCell() {
    if (!editingCell) return;
    const { rowIdx, col, value } = editingCell;
    setEditingCell(null);
    const row = rows[rowIdx];
    if (row[col] === value || (row[col] == null && value === '')) return; // no change
    const sql = `UPDATE "${tableName}" SET "${col}" = ${literal(value)} WHERE rowid = ${Number(row.__rowid)}`;
    try { await api.execD1(db.uuid, sql); await reload(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function deleteRow(row: Record<string, any>) {
    const ok = await confirm({
      title: `Delete row ${row.__rowid} from ${tableName}?`,
      message: "Can't undo.",
      variant: 'danger',
      confirmLabel: 'Delete row',
    });
    if (!ok) return;
    try { await api.execD1(db.uuid, `DELETE FROM "${tableName}" WHERE rowid = ${Number(row.__rowid)}`); await reload(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-mono text-fg-dim">
          {columns.length} column{columns.length === 1 ? '' : 's'} · {rows.length} row{rows.length === 1 ? '' : 's'}
          {rows.length === 200 && <span className="text-yellow-300"> (capped at 200; use SQL tab for more)</span>}
        </div>
        <button onClick={() => setAdding(true)}
          className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-3 py-1.5 text-xs font-semibold">
          + Insert row
        </button>
      </div>

      {err && <ErrorBox text={err} />}

      <div className="bg-bg-elev border border-border rounded overflow-auto max-h-[500px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-elev border-b border-border">
            <tr>
              {columns.map(c => (
                <th key={c.name} className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-fg-muted font-semibold whitespace-nowrap">
                  {c.name}
                  {c.pk ? <span className="text-yellow-300 ml-1">PK</span> : null}
                  <span className="text-fg-faint ml-2">{c.type || 'BLOB'}</span>
                </th>
              ))}
              <th className="px-3 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-border-subtle last:border-b-0 hover:bg-bg/40">
                {columns.map(c => (
                  <td key={c.name}
                    onClick={() => setEditingCell({ rowIdx, col: c.name, value: row[c.name] == null ? '' : String(row[c.name]) })}
                    className="px-3 py-1.5 font-mono text-[11px] text-fg whitespace-nowrap cursor-text"
                    title={row[c.name] == null ? '(null) — click to edit' : 'click to edit'}>
                    {editingCell && editingCell.rowIdx === rowIdx && editingCell.col === c.name ? (
                      <input autoFocus value={editingCell.value}
                        onChange={e => setEditingCell({ ...editingCell, value: e.target.value })}
                        onBlur={commitCell}
                        onKeyDown={e => { if (e.key === 'Enter') commitCell(); if (e.key === 'Escape') setEditingCell(null); }}
                        className="bg-bg border border-fg rounded px-1 font-mono text-[11px] text-fg w-full" />
                    ) : (
                      row[c.name] == null ? <span className="text-fg-dim">—</span> : String(row[c.name])
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => deleteRow(row)} className="text-red-300 hover:text-red-200 text-[11px]">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-fg-dim text-[11px]">empty</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && <InsertDialog db={db} tableName={tableName} columns={columns} onDone={() => { setAdding(false); reload(); }} onClose={() => setAdding(false)} />}
    </div>
  );
}

function InsertDialog({ db, tableName, columns, onDone, onClose }: {
  db: D1Database; tableName: string; columns: ColumnInfo[];
  onDone: () => void; onClose: () => void;
}) {
  // Skip auto-increment PK columns — SQLite fills those itself.
  const editable = columns.filter(c => !(c.pk && c.type.toUpperCase().includes('INT')));
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(editable.map(c => [c.name, '']))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const cols = editable.map(c => `"${c.name}"`).join(', ');
      const vals = editable.map(c => literal(values[c.name] || '')).join(', ');
      await api.execD1(db.uuid, `INSERT INTO "${tableName}" (${cols}) VALUES (${vals})`);
      onDone();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[480px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Insert into {tableName}</h2>
        </header>
        <div className="p-6 space-y-3">
          {editable.map(c => (
            <label key={c.name} className="block space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
                {c.name} <span className="text-fg-faint">{c.type}</span>
                {c.notnull ? <span className="text-yellow-300 ml-1">NOT NULL</span> : ''}
              </span>
              <input value={values[c.name]} onChange={e => setValues(v => ({ ...v, [c.name]: e.target.value }))}
                spellCheck={false}
                className="w-full bg-bg-elev border border-border rounded px-3 py-2 font-mono text-sm" />
            </label>
          ))}
          {err && <ErrorBox text={err} />}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-fg-muted hover:text-fg">Cancel</button>
            <button onClick={submit} disabled={busy}
              className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
              {busy ? 'Inserting…' : 'Insert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Quote a value safely for embedding in SQL. Numbers stay as numbers; null
 *  for empty (so NOT NULL columns surface the error clearly); everything else
 *  is single-quoted with internal apostrophes doubled. */
function literal(v: string): string {
  const t = v.trim();
  if (t === '') return 'NULL';
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  return `'${v.replace(/'/g, "''")}'`;
}

// ── SQL console (unchanged from earlier, simpler shell) ─────────────────

function SqlConsole({ db }: { db: D1Database }) {
  const [query, setQuery] = useState("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
  const [result, setResult] = useState<D1QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true); setErr(null);
    try { setResult(await api.execD1(db.uuid, query)); }
    catch (e: any) { setErr(e?.message ?? String(e)); setResult(null); }
    finally { setRunning(false); }
  }
  useEffect(() => { run(); }, []);

  return (
    <div className="space-y-3 pt-2">
      <textarea value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run(); }}
        spellCheck={false} rows={5}
        className="w-full bg-bg border border-border rounded-md px-3 py-2 font-mono text-sm text-fg resize-y focus:outline-none focus:border-border-strong" />
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-fg-dim font-mono">
          <kbd className="px-1.5 py-0.5 border border-border rounded">Ctrl</kbd><span className="mx-1">+</span>
          <kbd className="px-1.5 py-0.5 border border-border rounded">Enter</kbd><span className="ml-2">to run</span>
        </div>
        <button onClick={run} disabled={running}
          className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-1.5 text-xs font-semibold disabled:opacity-40">
          {running ? 'Running…' : 'Run query'}
        </button>
      </div>
      {err && <ErrorBox text={err} />}
      {result && <ResultTable r={result} />}
    </div>
  );
}

function ResultTable({ r }: { r: D1QueryResult }) {
  if (!r.success) return <ErrorBox text={r.error ?? 'Query failed'} />;
  const rows = r.results ?? [];
  if (rows.length === 0) {
    return (
      <div className="bg-bg-elev border border-border rounded-md p-4 text-sm text-fg-muted">
        Query ran. No rows.
        <div className="text-[11px] text-fg-dim mt-1 font-mono">
          {r.meta?.changes != null && `changes: ${r.meta.changes} · `}
          {r.meta?.duration != null && `${r.meta.duration.toFixed(1)}ms`}
        </div>
      </div>
    );
  }
  const cols = Object.keys(rows[0]);
  return (
    <div className="bg-bg-elev border border-border rounded-md overflow-auto max-h-[400px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-bg-elev border-b border-border">
          <tr>{cols.map(c => <th key={c} className="text-left px-3 py-2 font-mono text-[11px] text-fg-dim font-normal">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border-subtle last:border-b-0">
              {cols.map(c => <td key={c} className="px-3 py-2 font-mono text-[11px] text-fg whitespace-nowrap">{cellRepr(row[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[10px] text-fg-dim font-mono border-t border-border">
        {rows.length} row{rows.length === 1 ? '' : 's'}
        {r.meta?.duration != null && ` · ${r.meta.duration.toFixed(1)}ms`}
      </div>
    </div>
  );
}

function cellRepr(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
