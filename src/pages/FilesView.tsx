import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api } from '@/lib/ipc';
import { getConnection } from '@/lib/connection';
import { useStore } from '@/lib/store';
import { PageShell, PageHeader } from '@/components/PageShell';
import { RemoteFolderPicker } from '@/components/RemoteFolderPicker';

type Mirror = {
  id: string;
  remoteRoot: string;
  localPath: string;
  snapshotPath: string;
  // initial sync progress
  syncedFiles: number;
  totalFiles: number;
  status: 'syncing' | 'ready' | 'applying' | 'error';
  lastEvent: string | null;
  // apply progress
  uploadedFiles: number;
  uploadTotal: number;
  errors: string[];
};

type Dirty = {
  rel: string;
  // Snapshot mode emits "modified" | "added" | "deleted".
  // Live mode (Compare button) also emits "local_only" | "remote_only".
  status: 'modified' | 'added' | 'deleted' | 'local_only' | 'remote_only';
  plus: number;
  minus: number;
  binary: boolean;
};

// Schema v2 = snapshot-based staging workflow. Bumping the key wipes any
// old in-flight state so a hot-reload during development can't load stale
// entries that don't match the current shape.
const LS_KEY = 'cf-tunnel-manager:mirrors:v2';
const LEGACY_LS_KEY = 'cf-tunnel-manager:mirrors';
const VALID_ID_RE = /^m[0-9a-f]{16}$/;

function loadMirrors(): Mirror[] {
  // Drop any legacy schema key on first load so we never touch it again.
  try { localStorage.removeItem(LEGACY_LS_KEY); } catch {}
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed: Mirror[] = JSON.parse(raw);
      return parsed.filter(
        (m) =>
          VALID_ID_RE.test(m.id) &&
          typeof m.localPath === 'string' &&
          typeof m.snapshotPath === 'string' &&
          m.localPath.length > 0 &&
          m.snapshotPath.length > 0,
      );
    }
  } catch {}
  return [];
}
function saveMirrors(ms: Mirror[]) {
  // Strip transient progress fields before persisting so a reload doesn't
  // restore stale "uploading…" state.
  const slim = ms.map((m) => ({ ...m, status: 'ready' as const, lastEvent: null, uploadedFiles: 0, uploadTotal: 0 }));
  localStorage.setItem(LS_KEY, JSON.stringify(slim));
}

function endpoint() {
  const conn = getConnection();
  if (conn.mode === 'remote' && conn.remote) {
    return { baseUrl: conn.remote.baseUrl, token: conn.remote.token };
  }
  return { baseUrl: '', token: '' };
}

export function FilesView() {
  const [mirrors, setMirrors] = useState<Mirror[]>(() => loadMirrors());
  const [dirtyByMirror, setDirtyByMirror] = useState<Record<string, Dirty[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState<{ mirrorId: string; rel: string } | null>(null);
  const [compareAllOpen, setCompareAllOpen] = useState<string | null>(null);
  const [purgeZoneByMirror, setPurgeZoneByMirror] = useState<Record<string, string>>({});
  const { zones, refreshZones, hasToken } = useStore();
  const unlistensRef = useRef<Map<string, UnlistenFn>>(new Map());

  useEffect(() => {
    if (hasToken && zones.length === 0) refreshZones().catch(() => {});
  }, [hasToken]);

  useEffect(() => { saveMirrors(mirrors); }, [mirrors]);

  // Subscribe to per-mirror events. Refresh dirty list whenever the watcher
  // says something changed. Unlistens for any mirror whose id is no longer
  // in the list — without this, removing a mirror leaks its listener and
  // the next mirror with the same id (unlikely but possible after re-pair)
  // gets duplicate handlers firing.
  useEffect(() => {
    const currentIds = new Set(mirrors.map((m) => m.id));
    // 1) Drop listeners for ids that no longer exist.
    for (const [id, un] of Array.from(unlistensRef.current.entries())) {
      if (!currentIds.has(id)) {
        try { un(); } catch {}
        unlistensRef.current.delete(id);
      }
    }
    // 2) Register listeners for new ids.
    for (const m of mirrors) {
      if (unlistensRef.current.has(m.id)) continue;
      const channel = `mirror://${m.id}/event`;
      listen<any>(channel, (e) => {
        const evt = e.payload;
        setMirrors((current) =>
          current.map((cm) => {
            if (cm.id !== m.id) return cm;
            switch (evt.kind) {
              case 'synced_file':
                return {
                  ...cm,
                  syncedFiles: evt.index,
                  totalFiles: evt.total,
                  status: 'syncing',
                  lastEvent: `${evt.index}/${evt.total}: ${evt.rel}`,
                };
              case 'sync_done':
                refreshDirty(cm);
                return { ...cm, localPath: evt.local_path, status: 'ready', lastEvent: 'Sync complete' };
              case 'dirty_changed':
                refreshDirty(cm);
                return cm;
              case 'uploaded':
                return {
                  ...cm,
                  status: 'applying',
                  uploadedFiles: evt.index,
                  uploadTotal: evt.total,
                  lastEvent: `↑ ${evt.rel}`,
                };
              case 'apply_done':
                refreshDirty(cm);
                return {
                  ...cm,
                  status: 'ready',
                  uploadedFiles: 0,
                  uploadTotal: 0,
                  lastEvent: evt.failed > 0
                    ? `Applied ${evt.ok}, ${evt.failed} failed`
                    : `Applied ${evt.ok} file${evt.ok === 1 ? '' : 's'}`,
                };
              case 'warning':
                return {
                  ...cm,
                  errors: [...cm.errors.slice(-9), evt.message],
                  lastEvent: `! ${evt.message}`,
                };
              default:
                return cm;
            }
          }),
        );
      }).then((un) => {
        // Mirror might have been removed between listen() resolving and
        // here — if so, immediately unlisten so we don't leak.
        if (unlistensRef.current.has(m.id) || !currentIds.has(m.id)) {
          try { un(); } catch {}
          return;
        }
        unlistensRef.current.set(m.id, un);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirrors.map((m) => m.id).join('|')]);

  // Unmount cleanup — drop every active listener so a hot-reload or route
  // change doesn't pile up duplicates.
  useEffect(() => {
    return () => {
      for (const un of unlistensRef.current.values()) {
        try { un(); } catch {}
      }
      unlistensRef.current.clear();
    };
  }, []);

  // Initial setup for mirrors restored from localStorage on app launch.
  // The Rust side's WATCHERS map is empty after a process restart, so we
  // re-start the file watcher for each one. Without this, mirrors loaded
  // from localStorage would have no live watcher — the user would have to
  // click "Check" to see pending changes.
  const restartedWatchersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ep = endpoint();
    for (const m of mirrors) {
      if (dirtyByMirror[m.id] === undefined && m.status === 'ready') {
        refreshDirty(m);
      }
      if (!restartedWatchersRef.current.has(m.id) && m.status === 'ready' && m.localPath) {
        restartedWatchersRef.current.add(m.id);
        invoke('mirror_start_watch', {
          mirrorId: m.id,
          endpoint: ep,
          remoteRoot: m.remoteRoot,
          localRoot: m.localPath,
        }).catch((e) => console.warn('[mirror_start_watch on load]', e?.message ?? e));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirrors.length]);

  async function refreshDirty(m: Mirror) {
    // Guard: never invoke with undefined/empty args. A stale in-memory state
    // (from a hot-reload before this code path tightened up) used to fire
    // mirror_diff_status with snapshotRoot = undefined and crash.
    if (!m.localPath || !m.snapshotPath) {
      console.warn('skipping refreshDirty for incomplete mirror', m.id);
      return;
    }
    try {
      const dirty = await invoke<Dirty[]>('mirror_diff_status', {
        localRoot: m.localPath,
        snapshotRoot: m.snapshotPath,
      });
      setDirtyByMirror((d) => ({ ...d, [m.id]: dirty }));
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error('mirror_diff_status', e);
      // If the snapshot is gone (folder deleted manually, drive disappeared,
      // crash mid-sync), mark the mirror as broken so the UI can offer
      // recovery instead of looping the same error.
      if (/snapshot|no such file|doesn'?t exist|cannot find/i.test(msg)) {
        setMirrors((ms) =>
          ms.map((cm) =>
            cm.id === m.id ? { ...cm, status: 'error', lastEvent: `Snapshot missing — re-sync to recover. (${msg})` } : cm,
          ),
        );
      }
    }
  }

  async function addMirror(remoteRoot: string) {
    setPickerOpen(false);
    const ep = endpoint();
    let mirrorId: string;
    let localPath: string;
    let snapshotPath: string;
    try {
      const r = await invoke<{ mirrorId: string; localPath: string; snapshotPath: string }>(
        'mirror_resolve',
        { baseUrl: ep.baseUrl, remoteRoot },
      );
      ({ mirrorId, localPath, snapshotPath } = r);
    } catch (e) {
      console.error('mirror_resolve failed', e);
      return;
    }

    setMirrors((current) => {
      if (current.some((m) => m.id === mirrorId)) return current;
      return [
        ...current,
        {
          id: mirrorId,
          remoteRoot,
          localPath,
          snapshotPath,
          syncedFiles: 0,
          totalFiles: 0,
          status: 'syncing',
          lastEvent: 'Starting initial sync…',
          uploadedFiles: 0,
          uploadTotal: 0,
          errors: [],
        },
      ];
    });

    try {
      await invoke('mirror_sync_down', {
        mirrorId,
        endpoint: ep,
        remoteRoot,
        localRoot: localPath,
        snapshotRoot: snapshotPath,
      });
      await invoke('mirror_start_watch', {
        mirrorId,
        endpoint: ep,
        remoteRoot,
        localRoot: localPath,
      });
    } catch (e: any) {
      setMirrors((m) =>
        m.map((cm) =>
          cm.id === mirrorId ? { ...cm, status: 'error', lastEvent: e?.message ?? String(e) } : cm,
        ),
      );
    }
  }

  async function unmirror(m: Mirror) {
    // Always wipe the local mirror folder when the user clicks Unmirror —
    // the watcher held a handle that made manual Explorer-deletion fail.
    // The server's actual files are untouched.
    try {
      await invoke('mirror_delete_local', {
        mirrorId: m.id,
        localPath: m.localPath,
        snapshotPath: m.snapshotPath,
      });
    } catch (e) {
      console.warn('mirror_delete_local failed (best effort)', e);
      // Make sure the watcher is at least stopped even if the delete failed.
      try { await invoke('mirror_stop_watch', { mirrorId: m.id }); } catch {}
    }
    setMirrors((ms) => ms.filter((x) => x.id !== m.id));
    setDirtyByMirror((d) => { const { [m.id]: _, ...rest } = d; return rest; });
  }

  /// Recover from a broken mirror (snapshot dir gone, or crash mid-sync).
  /// Re-downloads from remote and rebuilds the snapshot. Local edits in
  /// `working/` survive because sync_down only touches files the remote
  /// has — it doesn't delete untracked locals.
  async function resync(m: Mirror) {
    const ep = endpoint();
    setMirrors((ms) =>
      ms.map((cm) =>
        cm.id === m.id ? { ...cm, status: 'syncing', lastEvent: 'Re-syncing…', syncedFiles: 0, totalFiles: 0 } : cm,
      ),
    );
    try {
      await invoke('mirror_sync_down', {
        mirrorId: m.id,
        endpoint: ep,
        remoteRoot: m.remoteRoot,
        localRoot: m.localPath,
        snapshotRoot: m.snapshotPath,
      });
      await invoke('mirror_start_watch', {
        mirrorId: m.id,
        endpoint: ep,
        remoteRoot: m.remoteRoot,
        localRoot: m.localPath,
      });
    } catch (e: any) {
      setMirrors((ms) =>
        ms.map((cm) =>
          cm.id === m.id ? { ...cm, status: 'error', lastEvent: e?.message ?? String(e) } : cm,
        ),
      );
    }
  }

  /// Escape-hatch: clear all mirrors + their localStorage state. Useful if
  /// the UI gets wedged from a partial state — folders on disk are NOT
  /// deleted, so the user can re-mirror without data loss.
  async function clearAllMirrors() {
    for (const m of mirrors) {
      try { await invoke('mirror_stop_watch', { mirrorId: m.id }); } catch {}
    }
    setMirrors([]);
    setDirtyByMirror({});
    try { localStorage.removeItem(LS_KEY); } catch {}
  }

  async function openLocalFolder(path: string) {
    try { await api.openLocalFolder(path); } catch (e) { console.error('open folder', e); }
  }

  async function apply(m: Mirror) {
    const ep = endpoint();
    setMirrors((ms) => ms.map((cm) => (cm.id === m.id ? { ...cm, status: 'applying', uploadedFiles: 0, uploadTotal: 0, lastEvent: 'Uploading…' } : cm)));
    try {
      await invoke('mirror_apply', {
        mirrorId: m.id,
        endpoint: ep,
        remoteRoot: m.remoteRoot,
        localRoot: m.localPath,
        snapshotRoot: m.snapshotPath,
      });
    } catch (e: any) {
      setMirrors((ms) => ms.map((cm) => (cm.id === m.id ? { ...cm, status: 'error', lastEvent: e?.message ?? String(e) } : cm)));
    }
  }

  async function cancel(m: Mirror) {
    const ep = endpoint();
    try {
      await invoke('mirror_cancel', {
        mirrorId: m.id,
        endpoint: ep,
        remoteRoot: m.remoteRoot,
        localRoot: m.localPath,
        snapshotRoot: m.snapshotPath,
      });
      refreshDirty(m);
    } catch (e) {
      console.error('mirror_cancel', e);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Files"
        subtitle="Mirror remote folders. Edit locally, review changes, then apply in one shot."
        actions={
          <>
            {mirrors.length > 0 && (
              <button
                onClick={clearAllMirrors}
                title="Clear all mirrors from this list. Disk folders are kept — re-mirror to pick them back up."
                className="h-9 text-xs px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => setPickerOpen(true)}
              className="h-9 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md px-4 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]"
            >
              + Mirror folder
            </button>
          </>
        }
      />

      {mirrors.length === 0 && (
        <div className="text-fg-dim text-sm py-6 border border-border-strong rounded-md text-center bg-bg/40">
          No mirrors yet. Click <span className="font-mono text-fg-muted">+ Mirror folder</span> to
          pick a folder on the server.
        </div>
      )}

      <div className="space-y-3">
        {mirrors.map((m) => {
          const dirty = dirtyByMirror[m.id] ?? [];
          const totalPlus = dirty.reduce((acc, d) => acc + d.plus, 0);
          const totalMinus = dirty.reduce((acc, d) => acc + d.minus, 0);
          const applyPct = m.uploadTotal > 0
            ? Math.round((m.uploadedFiles / m.uploadTotal) * 100)
            : 0;
          const syncPct = m.totalFiles > 0
            ? Math.round((m.syncedFiles / m.totalFiles) * 100)
            : 0;

          return (
            <div
              key={m.id}
              className="bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] border border-border-strong rounded-md p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-fg flex items-center gap-2">
                    <StatusDot status={m.status} />
                    <span className="font-mono break-all">{m.remoteRoot}</span>
                  </div>
                  <div className="text-[11px] font-mono text-fg-dim mt-1 break-all">
                    ↔ {m.localPath || '(resolving…)'}
                  </div>
                  {m.lastEvent && (
                    <div className="text-[11px] font-mono text-fg-muted mt-1 truncate" title={m.lastEvent}>
                      {m.lastEvent}
                    </div>
                  )}
                  {m.status === 'syncing' && m.totalFiles > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="h-1 bg-bg rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-400 transition-[width] duration-200" style={{ width: `${syncPct}%` }} />
                      </div>
                      <div className="text-[10px] font-mono text-fg-dim">{m.syncedFiles}/{m.totalFiles}</div>
                    </div>
                  )}
                  {m.status === 'applying' && m.uploadTotal > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="h-1 bg-bg rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 transition-[width] duration-200" style={{ width: `${applyPct}%` }} />
                      </div>
                      <div className="text-[10px] font-mono text-fg-dim">Uploading {m.uploadedFiles}/{m.uploadTotal}</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  {m.localPath && (
                    <button
                      onClick={() => openLocalFolder(m.localPath)}
                      className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev"
                    >
                      Open in Explorer
                    </button>
                  )}
                  <button
                    onClick={() => refreshDirty(m)}
                    title="Re-check for unsaved local changes."
                    className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev"
                  >
                    ↻ Check
                  </button>
                  <button
                    onClick={() => setCompareAllOpen(m.id)}
                    disabled={m.status !== 'ready' && m.status !== 'error'}
                    title={dirty.length > 0 ? `Compare ${dirty.length} pending change(s)` : 'No pending changes yet'}
                    className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev disabled:opacity-40"
                  >
                    Compare{dirty.length > 0 ? ` (${dirty.length})` : ''}
                  </button>
                  {m.status === 'error' && (
                    <button
                      onClick={() => resync(m)}
                      className="h-8 text-[11px] px-3 bg-yellow-600/80 hover:bg-yellow-600 text-bg rounded-md font-semibold"
                    >
                      ↻ Re-sync
                    </button>
                  )}
                  <button
                    onClick={() => unmirror(m)}
                    className="h-8 text-[11px] px-3 text-red-400 hover:text-red-300"
                  >
                    Unmirror
                  </button>
                </div>
              </div>

              {/* Pending changes */}
              {dirty.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-xs font-semibold text-fg">
                      Pending changes
                      <span className="text-fg-dim font-normal ml-2">
                        {dirty.length} file{dirty.length === 1 ? '' : 's'}
                        {' · '}
                        <span className="text-green-300">+{totalPlus}</span>
                        {' '}
                        <span className="text-red-300">-{totalMinus}</span>
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCompareAllOpen(m.id)}
                        disabled={m.status === 'applying'}
                        className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev disabled:opacity-40"
                      >
                        Compare all
                      </button>
                      <button
                        onClick={() => cancel(m)}
                        disabled={m.status === 'applying'}
                        className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev disabled:opacity-40"
                      >
                        Cancel changes
                      </button>
                      <button
                        onClick={() => apply(m)}
                        disabled={m.status === 'applying'}
                        className="h-8 text-[11px] px-3 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md font-semibold disabled:opacity-40 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]"
                      >
                        {m.status === 'applying' ? `Applying ${m.uploadedFiles}/${m.uploadTotal}` : `Apply ${dirty.length}`}
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-0.5">
                    {dirty.map((d) => (
                      <li key={d.rel} className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-elev/60">
                        <StatusBadge status={d.status} />
                        <span className="flex-1 truncate text-fg text-[11px] font-mono" title={d.rel}>{d.rel}</span>
                        {!d.binary && (
                          <>
                            {d.plus > 0 && <span className="text-[11px] font-mono text-green-300">+{d.plus}</span>}
                            {d.minus > 0 && <span className="text-[11px] font-mono text-red-300">-{d.minus}</span>}
                          </>
                        )}
                        {d.binary && <span className="text-[11px] font-mono text-fg-dim">(binary)</span>}
                        <button
                          onClick={() => setDiffOpen({ mirrorId: m.id, rel: d.rel })}
                          className="text-[10px] font-mono px-2 py-0.5 border border-border-strong rounded text-fg-muted hover:text-fg hover:bg-bg transition"
                        >
                          Compare
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {dirty.length === 0 && m.status === 'ready' && (
                <div className="text-[11px] text-fg-dim border-t border-border pt-3">
                  No pending changes. Edit files in the mirror folder and they'll appear here.
                </div>
              )}

              {/* Post-apply cache purge. Show whenever a zone is selected
                  for this mirror — quick "click here to make the changes
                  visible on the live site" action. */}
              {zones.length > 0 && (
                <div className="border-t border-border pt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-fg-dim">Edge cache:</span>
                  <select
                    value={purgeZoneByMirror[m.id] ?? ''}
                    onChange={(e) => setPurgeZoneByMirror((p) => ({ ...p, [m.id]: e.target.value }))}
                    className="bg-bg border border-border rounded-md px-2 py-1 text-[11px] font-mono"
                  >
                    <option value="">— pick zone —</option>
                    {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                  <PurgeButton zoneId={purgeZoneByMirror[m.id] ?? ''} />
                </div>
              )}

              {m.errors.some((e) => e.startsWith('[db-locked]')) && (
                <div className="text-[11px] font-mono border border-amber-500/60 bg-amber-950/30 text-amber-100 rounded-md p-2.5 space-y-1">
                  <div className="font-semibold text-amber-200">⚠ Database file failed to push</div>
                  <div className="text-amber-100/80 leading-relaxed">
                    A <code className="text-amber-50">.db</code> / SQLite file couldn't be uploaded — the server most likely still has it open.
                    Stop the website on the server (so SQLite releases its lock), then click <strong>Apply</strong> again.
                  </div>
                  <ul className="mt-1 space-y-0.5 pl-4 text-amber-200/70 list-disc">
                    {m.errors
                      .filter((e) => e.startsWith('[db-locked]'))
                      .slice(-3)
                      .map((err, i) => (
                        <li key={i} className="break-all">{err.replace(/^\[db-locked\]\s*/, '')}</li>
                      ))}
                  </ul>
                </div>
              )}
              {m.errors.length > 0 && (
                <details className="text-[11px] font-mono text-yellow-200/80 border-t border-border pt-2">
                  <summary className="cursor-pointer">
                    {m.errors.length} warning{m.errors.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {m.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {pickerOpen && (
        <RemoteFolderPicker
          title="Pick a folder on the remote server to mirror"
          onClose={() => setPickerOpen(false)}
          onPick={addMirror}
        />
      )}

      {diffOpen && (
        <DiffModal
          mirror={mirrors.find((m) => m.id === diffOpen.mirrorId)!}
          rel={diffOpen.rel}
          onClose={() => setDiffOpen(null)}
        />
      )}

      {compareAllOpen && (() => {
        const m = mirrors.find((x) => x.id === compareAllOpen);
        if (!m) return null;
        return (
          <LiveCompareModal
            mirror={m}
            onClose={() => setCompareAllOpen(null)}
            onAppliedRefresh={() => refreshDirty(m)}
          />
        );
      })()}
    </PageShell>
  );
}

function PurgeButton({ zoneId }: { zoneId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function purge() {
    if (!zoneId) return;
    setBusy(true); setMsg(null);
    try {
      await api.purgeCache(zoneId);
      setMsg('✓ purged');
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      setMsg(`✗ ${e?.message ?? String(e)}`);
    } finally { setBusy(false); }
  }
  return (
    <>
      <button
        onClick={purge}
        disabled={!zoneId || busy}
        title="Purge Cloudflare's edge cache for the selected zone so live visitors see fresh content."
        className="h-7 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev disabled:opacity-40"
      >
        {busy ? 'Purging…' : 'Purge'}
      </button>
      {msg && <span className={`text-[11px] font-mono ${msg.startsWith('✓') ? 'text-green-300' : 'text-red-300'}`}>{msg}</span>}
    </>
  );
}

function StatusDot({ status }: { status: Mirror['status'] }) {
  const cls =
    status === 'ready' ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.55)]' :
    status === 'syncing' ? 'bg-yellow-400 animate-pulse' :
    status === 'applying' ? 'bg-blue-400 animate-pulse' :
    status === 'error' ? 'bg-red-400' : 'bg-zinc-500';
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

function StatusBadge({ status }: { status: Dirty['status'] }) {
  const map: Record<Dirty['status'], { label: string; cls: string; title: string }> = {
    modified:    { label: 'M',  cls: 'text-yellow-300 border-yellow-700/40 bg-yellow-950/30', title: 'Modified — content differs between local and remote' },
    added:       { label: 'A',  cls: 'text-green-300 border-green-700/40 bg-green-950/30',    title: 'Added locally — exists locally, not on server' },
    deleted:     { label: 'D',  cls: 'text-red-300 border-red-700/40 bg-red-950/30',          title: 'Deleted — was in snapshot, not in working' },
    local_only:  { label: 'L',  cls: 'text-green-300 border-green-700/40 bg-green-950/30',    title: 'Local only — will be uploaded to server' },
    remote_only: { label: 'R',  cls: 'text-blue-300 border-blue-700/40 bg-blue-950/30',       title: 'Remote only — exists on server, not locally' },
  };
  const { label, cls, title } = map[status];
  return (
    <span title={title} className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

function LiveCompareModal({
  mirror, onClose, onAppliedRefresh,
}: {
  mirror: Mirror;
  onClose: () => void;
  onAppliedRefresh: () => void;
}) {
  const ep = endpoint();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Dirty[]>([]);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  // Default plan: push local_only + modified, pull remote_only. User can flip per row.
  const [plan, setPlan] = useState<Record<string, 'push' | 'pull' | 'delete_remote' | 'skip'>>({});
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState({ index: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    invoke<Dirty[]>('mirror_live_diff', {
      endpoint: ep,
      remoteRoot: mirror.remoteRoot,
      localRoot: mirror.localPath,
    })
      .then(async (entries) => {
        if (cancelled) return;
        setDirty(entries);
        // Seed default plan.
        const p: Record<string, 'push' | 'pull' | 'delete_remote' | 'skip'> = {};
        for (const e of entries) {
          p[e.rel] = e.status === 'remote_only' ? 'pull' : 'push';
        }
        setPlan(p);

        // Pre-fetch diff text for each modified/local_only file.
        const next: Record<string, string> = {};
        for (const e of entries) {
          if (cancelled) return;
          if (e.binary) continue;
          if (e.status === 'modified') {
            try {
              const [remote, local] = await Promise.all([
                invoke<string>('mirror_fetch_remote_text', { endpoint: ep, remoteRoot: mirror.remoteRoot, rel: e.rel }),
                fetch_local_text(mirror.localPath, e.rel),
              ]);
              next[e.rel] = unifiedDiff(remote, local);
            } catch {}
          } else if (e.status === 'local_only') {
            try { next[e.rel] = await fetch_local_text(mirror.localPath, e.rel); } catch {}
          } else if (e.status === 'remote_only') {
            try { next[e.rel] = await invoke<string>('mirror_fetch_remote_text', { endpoint: ep, remoteRoot: mirror.remoteRoot, rel: e.rel }); } catch {}
          }
        }
        if (!cancelled) {
          setDiffs(next);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setErr(e?.message ?? String(e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror.id]);

  // Listen for apply progress.
  useEffect(() => {
    const channel = `mirror://${mirror.id}/event`;
    let un: UnlistenFn | undefined;
    listen<any>(channel, (e) => {
      const evt = e.payload;
      if (evt.kind === 'uploaded') {
        setApplyProgress({ index: evt.index, total: evt.total });
      } else if (evt.kind === 'apply_done') {
        setApplying(false);
        setApplyProgress({ index: 0, total: 0 });
        onAppliedRefresh();
        onClose();
      }
    }).then((u) => { un = u; });
    return () => { if (un) un(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror.id]);

  async function applyPlan() {
    setApplying(true);
    setApplyProgress({ index: 0, total: 0 });
    try {
      await invoke('mirror_apply_live', {
        mirrorId: mirror.id,
        endpoint: ep,
        remoteRoot: mirror.remoteRoot,
        localRoot: mirror.localPath,
        snapshotRoot: mirror.snapshotPath,
        plan,
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setApplying(false);
    }
  }

  function setAction(rel: string, action: 'push' | 'pull' | 'delete_remote' | 'skip') {
    setPlan((p) => ({ ...p, [rel]: action }));
  }

  function pushAll() {
    setPlan((p) => {
      const next = { ...p };
      for (const e of dirty) {
        next[e.rel] = e.status === 'remote_only' ? 'delete_remote' : 'push';
      }
      return next;
    });
  }
  function pullAll() {
    setPlan((p) => {
      const next = { ...p };
      for (const e of dirty) {
        next[e.rel] = e.status === 'local_only' ? 'skip' : 'pull';
      }
      return next;
    });
  }

  const totalPlus = dirty.reduce((acc, d) => acc + d.plus, 0);
  const totalMinus = dirty.reduce((acc, d) => acc + d.minus, 0);
  const actionableCount = Object.values(plan).filter((a) => a !== 'skip').length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[1080px] max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold">Compare with server</div>
            <div className="text-[11px] font-mono text-fg-dim mt-0.5">
              {loading ? 'Loading…' : (
                <>
                  {dirty.length} file{dirty.length === 1 ? '' : 's'} differ ·{' '}
                  <span className="text-green-300">+{totalPlus}</span>{' '}
                  <span className="text-red-300">-{totalMinus}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <button onClick={pushAll} disabled={applying || loading} className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg disabled:opacity-40" title="Make server match local (push local + delete server-only)">
              Push all
            </button>
            <button onClick={pullAll} disabled={applying || loading} className="h-8 text-[11px] px-3 border border-border-strong rounded-md text-fg-muted hover:text-fg disabled:opacity-40" title="Pull server changes locally (skip local-only)">
              Pull all
            </button>
            <button
              onClick={applyPlan}
              disabled={applying || loading || actionableCount === 0}
              className="h-8 text-[11px] px-3 bg-gradient-to-b from-zinc-50 to-zinc-300 text-bg rounded-md font-semibold disabled:opacity-40 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]"
            >
              {applying
                ? applyProgress.total > 0
                  ? `Applying ${applyProgress.index}/${applyProgress.total}`
                  : 'Applying…'
                : `Apply ${actionableCount}`}
            </button>
            <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg leading-none px-2">×</button>
          </div>
        </header>

        {applying && applyProgress.total > 0 && (
          <div className="h-1 bg-bg">
            <div className="h-full bg-green-400 transition-[width] duration-200" style={{ width: `${Math.round((applyProgress.index / applyProgress.total) * 100)}%` }} />
          </div>
        )}

        <div className="flex-1 overflow-auto bg-[#0a0a0c] font-mono text-[11.5px] leading-relaxed">
          {err && <div className="p-4 text-red-300">{err}</div>}
          {!err && loading && <div className="p-6 text-fg-dim text-center text-sm">Comparing with server…</div>}
          {!err && !loading && dirty.length === 0 && (
            <div className="p-6 text-fg-dim text-center text-sm">Local and server are identical.</div>
          )}
          {!err && !loading && dirty.map((d) => (
            <div key={d.rel} className="border-b border-border last:border-b-0">
              <div className="sticky top-0 z-10 bg-bg-elev/95 backdrop-blur px-3 py-1.5 border-b border-border flex items-center gap-2 flex-wrap">
                <StatusBadge status={d.status} />
                <span className="flex-1 truncate text-fg min-w-0" title={d.rel}>{d.rel}</span>
                {!d.binary && d.plus > 0 && <span className="text-green-300">+{d.plus}</span>}
                {!d.binary && d.minus > 0 && <span className="text-red-300">-{d.minus}</span>}
                {d.binary && <span className="text-fg-dim">(binary)</span>}
                <select
                  value={plan[d.rel] ?? 'skip'}
                  onChange={(e) => setAction(d.rel, e.target.value as any)}
                  disabled={applying}
                  className="bg-bg border border-border rounded px-2 py-0.5 text-[10px] text-fg-muted"
                >
                  {d.status !== 'remote_only' && <option value="push">↑ Push to server</option>}
                  {d.status !== 'local_only' && <option value="pull">↓ Pull from server</option>}
                  {d.status === 'remote_only' && <option value="delete_remote">✗ Delete on server</option>}
                  <option value="skip">— Skip</option>
                </select>
              </div>
              <div className="px-3 py-2">
                {d.binary ? (
                  <div className="text-fg-dim">(binary file — content diff suppressed)</div>
                ) : diffs[d.rel] === undefined ? (
                  <div className="text-fg-dim">Loading…</div>
                ) : (
                  diffs[d.rel].split('\n').map((line, i) => {
                    const cls =
                      line.startsWith('+') ? 'text-green-300 bg-green-950/20' :
                      line.startsWith('-') ? 'text-red-300 bg-red-950/20' :
                      'text-fg-muted';
                    return <div key={i} className={`whitespace-pre ${cls}`}>{line || ' '}</div>;
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function fetch_local_text(localRoot: string, rel: string): Promise<string> {
  // Always reads from the laptop's filesystem — the mirror's working folder
  // is on this PC, not on the server. Bypass the ipc.ts isRemote() routing
  // by invoking the Tauri command directly.
  return invoke<string>('read_project_file', { folder: localRoot, rel });
}

function unifiedDiff(originalText: string, currentText: string): string {
  // Naive line-based diff — good enough for display. The server-side
  // similar::TextDiff is for status; this is for visual rendering when we
  // already have both sides as strings.
  const a = originalText.split('\n');
  const b = currentText.split('\n');
  const out: string[] = [];
  // Use a simple LCS-based diff.
  const lcs = lcsMatrix(a, b);
  walk(a.length, b.length);
  function walk(i: number, j: number) {
    if (i === 0 && j === 0) return;
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      walk(i - 1, j - 1);
      out.push(' ' + a[i - 1]);
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      walk(i, j - 1);
      out.push('+' + b[j - 1]);
    } else if (i > 0) {
      walk(i - 1, j);
      out.push('-' + a[i - 1]);
    }
  }
  return out.join('\n');
}

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const grid: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      grid[i][j] = a[i - 1] === b[j - 1] ? grid[i - 1][j - 1] + 1 : Math.max(grid[i - 1][j], grid[i][j - 1]);
    }
  }
  return grid;
}


function DiffModal({ mirror, rel, onClose }: { mirror: Mirror; rel: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>('mirror_diff_file', {
      localRoot: mirror.localPath,
      snapshotRoot: mirror.snapshotPath,
      rel,
    })
      .then(setText)
      .catch((e) => setErr(e?.message ?? String(e)));
  }, [mirror.id, rel]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-bg border border-border-strong rounded-lg w-[920px] max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Diff</div>
            <div className="text-[11px] font-mono text-fg-dim mt-0.5">{rel}</div>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg leading-none px-1">×</button>
        </header>
        <div className="flex-1 overflow-auto bg-[#0a0a0c] font-mono text-[11.5px] leading-relaxed">
          {err ? (
            <div className="p-4 text-red-300">{err}</div>
          ) : text === null ? (
            <div className="p-4 text-fg-dim">Loading…</div>
          ) : (
            <pre className="p-3">{text.split('\n').map((line, i) => {
              const cls =
                line.startsWith('+') ? 'text-green-300 bg-green-950/20' :
                line.startsWith('-') ? 'text-red-300 bg-red-950/20' :
                'text-fg-muted';
              return <div key={i} className={`whitespace-pre ${cls}`}>{line || ' '}</div>;
            })}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
