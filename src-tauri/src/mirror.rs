//! Remote-folder mirror with a git-like staging workflow.
//!
//! ## Layout
//! Each mirror lives at `<appdata>/mirrors/<id>/`:
//!   * `working/` — the live editable folder. The user edits here.
//!     Opened in Explorer via the "Open in Explorer" button on the Files view.
//!   * `.snapshot/` — read-only copy of the remote state at last sync. Used
//!     to compute diffs and to revert on "Cancel".
//!
//! ## Flow
//!   1. `mirror_sync_down` downloads the remote tree → `working/` AND mirrors
//!      it into `.snapshot/`.
//!   2. `mirror_start_watch` watches `working/`. On any change it emits a
//!      `DirtyChanged` event. **It does NOT upload automatically.**
//!   3. UI calls `mirror_diff_status` to list dirty files (+lines/-lines per
//!      file) and `mirror_diff_file` to show a unified diff.
//!   4. UI calls `mirror_apply` → uploads every dirty file to the remote
//!      (with per-file progress events) and refreshes the snapshot. Or
//!      `mirror_cancel` → restores dirty files from snapshot.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use cf_tunnel_core::error::{AppError, AppResult};
use cf_tunnel_core::fs_ops::Entry;
use cf_tunnel_core::state::AppState;

type WatcherRegistry = Mutex<HashMap<String, MirrorHandle>>;

struct MirrorHandle {
    _watcher: RecommendedWatcher,
}

static WATCHERS: once_cell::sync::Lazy<Arc<WatcherRegistry>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Per-mirror "apply in flight" guard. A second concurrent mirror_apply /
/// mirror_apply_live for the same mirror_id returns immediately with a
/// warning event instead of racing on the same files + interleaving
/// progress on the same channel.
static APPLYING: once_cell::sync::Lazy<Arc<Mutex<HashSet<String>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashSet::new())));

/// RAII guard so the apply id is released even on early return / panic.
struct ApplyGuard {
    mirror_id: String,
}
impl Drop for ApplyGuard {
    fn drop(&mut self) {
        APPLYING.lock().remove(&self.mirror_id);
    }
}
impl ApplyGuard {
    fn try_acquire(mirror_id: &str) -> Option<Self> {
        let mut g = APPLYING.lock();
        if g.contains(mirror_id) {
            None
        } else {
            g.insert(mirror_id.to_string());
            Some(Self { mirror_id: mirror_id.to_string() })
        }
    }
}

fn norm(rel: &str) -> String {
    rel.replace('/', std::path::MAIN_SEPARATOR_STR)
}

/// True for SQLite-family files. Used to enrich apply-failure warnings with
/// the "stop the website on the server" reminder — a DB push fails when the
/// server-side process still has the file locked.
fn looks_like_db(rel: &str) -> bool {
    const SUFFIXES: &[&str] = &[
        ".db", ".sqlite", ".sqlite3",
        ".db-shm", ".db-wal", ".db-journal",
        ".sqlite-shm", ".sqlite-wal", ".sqlite-journal",
        ".sqlite3-shm", ".sqlite3-wal", ".sqlite3-journal",
    ];
    let lower = rel.to_ascii_lowercase();
    SUFFIXES.iter().any(|s| lower.ends_with(s))
}

/// Distinctive prefix the FE keys off to show a prominent banner above the
/// usual collapsible warnings list. Keep this exact string in sync with
/// `FilesView.tsx`.
const DB_HINT_PREFIX: &str = "[db-locked]";

fn enrich_apply_error(rel: &str, err: &AppError) -> String {
    let raw = format!("{rel}: {err}");
    if looks_like_db(rel) {
        format!(
            "{DB_HINT_PREFIX} {raw} — the server probably still has this database open. Stop the website on the server, then click Apply again."
        )
    } else {
        raw
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEndpoint {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MirrorEvent {
    SyncedFile { rel: String, index: usize, total: usize },
    SyncDone { local_path: String },
    /// One of the watched files in `working/` was modified — the UI should
    /// re-run mirror_diff_status to show updated pending changes.
    DirtyChanged,
    /// During mirror_apply, one file finished uploading.
    Uploaded { rel: String, index: usize, total: usize },
    /// mirror_apply completed (or partially completed).
    ApplyDone { ok: usize, failed: usize },
    Warning { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorResolve {
    pub mirror_id: String,
    /// Path the user actually edits. NEW: this is `<base>/working/`.
    pub local_path: String,
    /// Snapshot path used for diffs/revert. Internal — not normally opened.
    pub snapshot_path: String,
}

#[tauri::command]
pub fn mirror_resolve(
    app: AppHandle,
    base_url: String,
    remote_root: String,
) -> AppResult<MirrorResolve> {
    use tauri::Manager;
    let mirror_id = mirror_id_for(&base_url, &remote_root);
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other { message: format!("app data dir: {e}") })?
        .join("mirrors")
        .join(&mirror_id);
    let working = base.join("working");
    let snapshot = base.join(".snapshot");
    Ok(MirrorResolve {
        mirror_id,
        local_path: working.to_string_lossy().into_owned(),
        snapshot_path: snapshot.to_string_lossy().into_owned(),
    })
}

// ── Sync down + snapshot ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mirror_sync_down(
    app: AppHandle,
    mirror_id: String,
    endpoint: RemoteEndpoint,
    remote_root: String,
    local_root: String,
    snapshot_root: String,
) -> AppResult<()> {
    // Event channel is keyed on the FE-supplied mirror_id, NOT a freshly
    // computed hash. If the connector restarts and its base URL changes,
    // hash(new_url, path) != stored mirror_id — events would emit to a
    // dead channel and the UI would hang.
    let channel = format!("mirror://{mirror_id}/event");

    let local = PathBuf::from(&local_root);
    let snap = PathBuf::from(&snapshot_root);
    std::fs::create_dir_all(&local).map_err(|e| AppError::Other {
        message: format!("mkdir {}: {e}", local.display()),
    })?;
    std::fs::create_dir_all(&snap).map_err(|e| AppError::Other {
        message: format!("mkdir {}: {e}", snap.display()),
    })?;

    let entries = list_remote(&endpoint, &remote_root).await?;
    let files: Vec<&Entry> = entries.iter().filter(|e| !e.is_dir).collect();
    let total = files.len();

    for (i, entry) in files.iter().enumerate() {
        let local_path = local.join(&entry.rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let snap_path = snap.join(&entry.rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = local_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Some(parent) = snap_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let bytes = download_remote(&endpoint, &remote_root, &entry.rel).await?;
        std::fs::write(&local_path, &bytes).map_err(|e| AppError::Other {
            message: format!("write {}: {e}", local_path.display()),
        })?;
        std::fs::write(&snap_path, &bytes).map_err(|e| AppError::Other {
            message: format!("write {}: {e}", snap_path.display()),
        })?;
        let _ = app.emit(
            &channel,
            MirrorEvent::SyncedFile {
                rel: entry.rel.clone(),
                index: i + 1,
                total,
            },
        );
    }
    let _ = app.emit(
        &channel,
        MirrorEvent::SyncDone {
            local_path: local.to_string_lossy().into_owned(),
        },
    );
    Ok(())
}

// ── Watcher: dirty marker (no auto-upload) ──────────────────────────────────

#[tauri::command]
pub async fn mirror_start_watch(
    app: AppHandle,
    _state: State<'_, AppState>,
    mirror_id: String,
    endpoint: RemoteEndpoint,
    remote_root: String,
    local_root: String,
) -> AppResult<String> {
    let _ = endpoint; // not used in the watcher, kept for API symmetry
    let _ = remote_root;
    let channel = format!("mirror://{mirror_id}/event");
    let local_path = PathBuf::from(&local_root);

    WATCHERS.lock().remove(&mirror_id); // replace any existing

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<notify::Event>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(evt) = res {
            let _ = tx.send(evt);
        }
    })
    .map_err(|e| AppError::Other { message: format!("notify init: {e}") })?;
    watcher
        .watch(&local_path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Other { message: format!("notify watch: {e}") })?;

    WATCHERS
        .lock()
        .insert(mirror_id.clone(), MirrorHandle { _watcher: watcher });

    let app_for_task = app.clone();
    let channel_for_task = channel.clone();
    tokio::spawn(async move {
        // Debounce: each save can generate several notify events; coalesce.
        let mut tick = tokio::time::interval(Duration::from_millis(400));
        let mut dirty_pending = false;
        loop {
            tokio::select! {
                evt = rx.recv() => {
                    let Some(_evt) = evt else { break };
                    dirty_pending = true;
                }
                _ = tick.tick() => {
                    if dirty_pending {
                        dirty_pending = false;
                        let _ = app_for_task.emit(&channel_for_task, MirrorEvent::DirtyChanged);
                    }
                }
            }
        }
    });

    Ok(mirror_id)
}

#[tauri::command]
pub fn mirror_stop_watch(mirror_id: String) -> AppResult<()> {
    WATCHERS.lock().remove(&mirror_id);
    Ok(())
}

/// Stop the watcher AND delete the local mirror folder on disk. Use this
/// when the user clicks Unmirror — the watcher's OS handle keeps Explorer
/// from deleting the folder cleanly, so we have to do it from inside the
/// process that owns the watcher.
///
/// Doesn't touch the remote — only the laptop's working copy + snapshot.
#[tauri::command]
pub async fn mirror_delete_local(
    mirror_id: String,
    local_path: String,
    snapshot_path: String,
) -> AppResult<()> {
    // 1. Drop the watcher first so Windows releases the directory handle.
    WATCHERS.lock().remove(&mirror_id);

    // 2. Give the OS a beat to actually unmap things. notify's drop is
    //    synchronous in Rust but Windows file-system caching can lag.
    tokio::time::sleep(Duration::from_millis(150)).await;

    // 3. Remove both the working tree and the snapshot. We accept transient
    //    failures (sharing violation, file in use) and retry a few times —
    //    common when an editor still has a buffer open.
    for dir in [&local_path, &snapshot_path] {
        let p = std::path::Path::new(dir);
        if !p.exists() { continue; }
        let mut last_err: Option<String> = None;
        for attempt in 0..5 {
            match std::fs::remove_dir_all(p) {
                Ok(()) => { last_err = None; break; }
                Err(e) => {
                    last_err = Some(e.to_string());
                    tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await;
                }
            }
        }
        if let Some(e) = last_err {
            return Err(AppError::Other {
                message: format!(
                    "couldn't delete {}: {e}. Close any editor or Explorer window pointed at this folder and try again.",
                    p.display()
                ),
            });
        }
    }

    // 4. Also remove the parent <mirrors>/<id>/ folder if it's now empty.
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        if parent.file_name().and_then(|s| s.to_str()) == Some(&mirror_id) {
            let _ = std::fs::remove_dir(parent);
        }
    }
    Ok(())
}

// ── Diff status + per-file diff ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyFile {
    pub rel: String,
    /// snapshot-mode: "modified" | "added" | "deleted"
    /// live-mode:     "modified" | "local_only" | "remote_only"
    pub status: &'static str,
    pub plus: usize,
    pub minus: usize,
    /// True if the file looks binary (skip line diff in UI).
    pub binary: bool,
}

#[tauri::command]
pub fn mirror_diff_status(
    local_root: String,
    snapshot_root: String,
) -> AppResult<Vec<DirtyFile>> {
    let local = PathBuf::from(&local_root);
    let snap = PathBuf::from(&snapshot_root);

    let local_files = walk_rel(&local)?;
    let snap_files = walk_rel(&snap)?;

    let mut out: Vec<DirtyFile> = Vec::new();

    // modified or added
    for rel in &local_files {
        let lp = local.join(rel);
        let sp = snap.join(rel);
        if !sp.exists() {
            let (plus, minus, binary) = file_diff_summary(None, &lp);
            out.push(DirtyFile { rel: rel.clone(), status: "added", plus, minus, binary });
            continue;
        }
        let lb = std::fs::read(&lp).unwrap_or_default();
        let sb = std::fs::read(&sp).unwrap_or_default();
        if lb == sb {
            continue;
        }
        let (plus, minus, binary) = file_diff_summary(Some(&sb), &lp);
        out.push(DirtyFile { rel: rel.clone(), status: "modified", plus, minus, binary });
    }
    // deleted
    for rel in &snap_files {
        if !local_files.contains(rel) {
            let sp = snap.join(rel);
            let sb = std::fs::read(&sp).unwrap_or_default();
            let lines = count_lines(&sb);
            out.push(DirtyFile {
                rel: rel.clone(),
                status: "deleted",
                plus: 0,
                minus: lines,
                binary: looks_binary(&sb),
            });
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

#[tauri::command]
pub fn mirror_diff_file(
    local_root: String,
    snapshot_root: String,
    rel: String,
) -> AppResult<String> {
    let local = PathBuf::from(&local_root).join(&rel);
    let snap = PathBuf::from(&snapshot_root).join(&rel);
    let original = std::fs::read(&snap).unwrap_or_default();
    let current = std::fs::read(&local).unwrap_or_default();
    if looks_binary(&original) || looks_binary(&current) {
        return Ok("(binary file — diff suppressed)".into());
    }
    let original_s = String::from_utf8_lossy(&original);
    let current_s = String::from_utf8_lossy(&current);
    let diff = similar::TextDiff::from_lines(&original_s, &current_s);
    let mut out = String::new();
    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            similar::ChangeTag::Delete => "-",
            similar::ChangeTag::Insert => "+",
            similar::ChangeTag::Equal => " ",
        };
        out.push_str(sign);
        out.push_str(change.value());
    }
    Ok(out)
}

// ── Live diff against current remote ────────────────────────────────────────

/// Compares the working folder against the *current* server state, not the
/// snapshot. This is what "Compare" is for after the user has been editing
/// for a while — the snapshot might be stale if the remote changed
/// externally (deploy, another connector, etc.), and a snapshot-only diff
/// would lie about what's actually divergent.
#[tauri::command]
pub async fn mirror_live_diff(
    endpoint: RemoteEndpoint,
    remote_root: String,
    local_root: String,
) -> AppResult<Vec<DirtyFile>> {
    let local = PathBuf::from(&local_root);
    let local_files = walk_rel(&local)?;
    let remote_entries = list_remote(&endpoint, &remote_root).await?;
    let remote_files: Vec<&Entry> = remote_entries.iter().filter(|e| !e.is_dir).collect();

    use std::collections::HashSet;
    let local_set: HashSet<&String> = local_files.iter().collect();
    let remote_set: HashSet<&String> = remote_files.iter().map(|e| &e.rel).collect();

    let mut out: Vec<DirtyFile> = Vec::new();

    // Remote files: check if they exist locally + whether contents differ.
    for entry in &remote_files {
        let local_path = local.join(norm(&entry.rel));
        if !local_set.contains(&entry.rel) {
            // Estimate "minus" lines from a quick remote fetch — useful for
            // the +/- summary. Skip for huge files. Network failure here is
            // surfaced (not swallowed) — otherwise a bogus 0/0 entry can
            // mask a real outage and produce a misleading diff.
            let (minus, binary) = if entry.size <= 1_048_576 {
                let bytes = download_remote(&endpoint, &remote_root, &entry.rel).await?;
                (count_lines(&bytes), looks_binary(&bytes))
            } else {
                (0, false)
            };
            out.push(DirtyFile {
                rel: entry.rel.clone(),
                status: "remote_only",
                plus: 0,
                minus,
                binary,
            });
            continue;
        }
        // Local + remote both have this file: compare bytes.
        let lb = std::fs::read(&local_path).map_err(|e| AppError::Other {
            message: format!("read {}: {e}", local_path.display()),
        })?;
        let rb = download_remote(&endpoint, &remote_root, &entry.rel).await?;
        if lb == rb {
            continue;
        }
        let binary = looks_binary(&lb) || looks_binary(&rb);
        let (plus, minus) = if binary {
            (0, 0)
        } else {
            line_plus_minus(&rb, &lb)
        };
        out.push(DirtyFile {
            rel: entry.rel.clone(),
            status: "modified",
            plus,
            minus,
            binary,
        });
    }

    // Local files not on remote = new locally.
    for rel in &local_files {
        if remote_set.contains(rel) { continue; }
        let local_path = local.join(norm(rel));
        let lb = std::fs::read(&local_path).map_err(|e| AppError::Other {
            message: format!("read {}: {e}", local_path.display()),
        })?;
        let plus = count_lines(&lb);
        let binary = looks_binary(&lb);
        out.push(DirtyFile {
            rel: rel.clone(),
            status: "local_only",
            plus,
            minus: 0,
            binary,
        });
    }

    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

/// Read a single remote file's content as text — used by the live Compare
/// modal to show diffs side-by-side with the current local copy.
#[tauri::command]
pub async fn mirror_fetch_remote_text(
    endpoint: RemoteEndpoint,
    remote_root: String,
    rel: String,
) -> AppResult<String> {
    let bytes = download_remote(&endpoint, &remote_root, &rel).await?;
    if looks_binary(&bytes) {
        return Ok("(binary file)".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Apply only the dirty entries the UI passes in (the result of a previous
/// live_diff call). Lets the UI selectively push: "Apply local changes" =
/// push modified + local_only; "Pull missing" = download remote_only.
#[tauri::command]
pub async fn mirror_apply_live(
    app: AppHandle,
    mirror_id: String,
    endpoint: RemoteEndpoint,
    remote_root: String,
    local_root: String,
    snapshot_root: String,
    // `plan`: map of rel → "push" | "pull" | "delete_remote" | "skip"
    plan: HashMap<String, String>,
) -> AppResult<()> {
    let channel = format!("mirror://{mirror_id}/event");

    let _guard = match ApplyGuard::try_acquire(&mirror_id) {
        Some(g) => g,
        None => {
            let _ = app.emit(&channel, MirrorEvent::Warning {
                message: "Another apply is already in progress for this mirror — ignoring this click.".into(),
            });
            return Ok(());
        }
    };

    let local = PathBuf::from(&local_root);
    let snap = PathBuf::from(&snapshot_root);

    let mut ok = 0usize;
    let mut failed = 0usize;
    // Collect + sort by rel — HashMap iter order is undefined; without this,
    // the per-file `index` in Uploaded events is meaningless and the
    // progress bar visibly jumps back and forth.
    let mut actionable: Vec<(&String, &String)> =
        plan.iter().filter(|(_, a)| a.as_str() != "skip").collect();
    actionable.sort_by(|a, b| a.0.cmp(b.0));
    let total = actionable.len();

    for (i, (rel, action)) in actionable.iter().enumerate() {
        let rel_os = norm(rel);
        let result = match action.as_str() {
            "push" => {
                let local_path = local.join(&rel_os);
                match std::fs::read(&local_path) {
                    Ok(bytes) => {
                        let r = upload_remote(&endpoint, &remote_root, rel, bytes.clone()).await;
                        if r.is_ok() {
                            let snap_path = snap.join(&rel_os);
                            if let Some(parent) = snap_path.parent() {
                                if let Err(e) = std::fs::create_dir_all(parent) {
                                    let _ = app.emit(&channel, MirrorEvent::Warning {
                                        message: format!("{rel}: snapshot mkdir failed ({e})"),
                                    });
                                }
                            }
                            if let Err(e) = std::fs::write(&snap_path, &bytes) {
                                let _ = app.emit(&channel, MirrorEvent::Warning {
                                    message: format!("{rel}: snapshot write failed ({e})"),
                                });
                            }
                        }
                        r
                    }
                    Err(e) => Err(AppError::Other { message: format!("read {}: {e}", local_path.display()) }),
                }
            }
            "pull" => {
                let bytes = download_remote(&endpoint, &remote_root, rel).await;
                match bytes {
                    Ok(b) => {
                        let local_path = local.join(&rel_os);
                        let snap_path = snap.join(&rel_os);
                        for p in [&local_path, &snap_path] {
                            if let Some(parent) = p.parent() {
                                if let Err(e) = std::fs::create_dir_all(parent) {
                                    let _ = app.emit(&channel, MirrorEvent::Warning {
                                        message: format!("{rel}: mkdir failed ({e})"),
                                    });
                                }
                            }
                        }
                        std::fs::write(&local_path, &b)
                            .and_then(|_| std::fs::write(&snap_path, &b))
                            .map_err(|e| AppError::Other { message: format!("write {}: {e}", local_path.display()) })
                    }
                    Err(e) => Err(e),
                }
            }
            "delete_remote" => {
                let r = delete_remote(&endpoint, &remote_root, rel).await;
                if r.is_ok() {
                    let snap_path = snap.join(&rel_os);
                    if let Err(e) = std::fs::remove_file(&snap_path) {
                        let _ = app.emit(&channel, MirrorEvent::Warning {
                            message: format!("{rel}: snapshot cleanup failed ({e})"),
                        });
                    }
                }
                r
            }
            _ => Ok(()),
        };

        match result {
            Ok(()) => {
                ok += 1;
                let _ = app.emit(&channel, MirrorEvent::Uploaded { rel: rel.to_string(), index: i + 1, total });
            }
            Err(e) => {
                failed += 1;
                let _ = app.emit(&channel, MirrorEvent::Warning {
                    message: enrich_apply_error(rel, &e),
                });
            }
        }
    }

    let _ = app.emit(&channel, MirrorEvent::ApplyDone { ok, failed });
    Ok(())
}

fn line_plus_minus(original: &[u8], current: &[u8]) -> (usize, usize) {
    let original_s = String::from_utf8_lossy(original);
    let current_s = String::from_utf8_lossy(current);
    let diff = similar::TextDiff::from_lines(&original_s, &current_s);
    let mut plus = 0;
    let mut minus = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => plus += 1,
            similar::ChangeTag::Delete => minus += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    (plus, minus)
}

// ── Apply / Cancel ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mirror_apply(
    app: AppHandle,
    mirror_id: String,
    endpoint: RemoteEndpoint,
    remote_root: String,
    local_root: String,
    snapshot_root: String,
) -> AppResult<()> {
    let channel = format!("mirror://{mirror_id}/event");

    // Concurrency guard — second Apply while one is in flight is a no-op
    // with a user-visible warning, not a silent racing upload.
    let _guard = match ApplyGuard::try_acquire(&mirror_id) {
        Some(g) => g,
        None => {
            let _ = app.emit(&channel, MirrorEvent::Warning {
                message: "Another apply is already in progress for this mirror — ignoring this click.".into(),
            });
            return Ok(());
        }
    };

    let status = mirror_diff_status(local_root.clone(), snapshot_root.clone())?;
    let total = status.len();
    let local = PathBuf::from(&local_root);
    let snap = PathBuf::from(&snapshot_root);

    let mut ok = 0usize;
    let mut failed = 0usize;

    for (i, f) in status.iter().enumerate() {
        let rel_os = norm(&f.rel);
        let push_result = if f.status == "deleted" {
            // Remove from remote + drop snapshot copy.
            let r = delete_remote(&endpoint, &remote_root, &f.rel).await;
            if r.is_ok() {
                let snap_path = snap.join(&rel_os);
                if let Err(e) = std::fs::remove_file(&snap_path) {
                    // Not fatal — log via warning so the user knows the
                    // snapshot is stale; without this the file looks
                    // permanently "modified" on next diff.
                    let _ = app.emit(&channel, MirrorEvent::Warning {
                        message: format!("{}: snapshot cleanup failed ({e})", f.rel),
                    });
                }
            }
            r
        } else {
            let local_path = local.join(&rel_os);
            match std::fs::read(&local_path) {
                Ok(bytes) => {
                    let r = upload_remote(&endpoint, &remote_root, &f.rel, bytes.clone()).await;
                    if r.is_ok() {
                        // Refresh snapshot so it matches the new remote state.
                        let snap_path = snap.join(&rel_os);
                        if let Some(parent) = snap_path.parent() {
                            if let Err(e) = std::fs::create_dir_all(parent) {
                                let _ = app.emit(&channel, MirrorEvent::Warning {
                                    message: format!("{}: snapshot mkdir failed ({e}) — file will appear modified until next sync", f.rel),
                                });
                            }
                        }
                        if let Err(e) = std::fs::write(&snap_path, &bytes) {
                            let _ = app.emit(&channel, MirrorEvent::Warning {
                                message: format!("{}: snapshot write failed ({e}) — file will appear modified until next sync", f.rel),
                            });
                        }
                    }
                    r
                }
                Err(e) => Err(AppError::Other {
                    message: format!("read {}: {e}", local_path.display()),
                }),
            }
        };

        match push_result {
            Ok(()) => {
                ok += 1;
                let _ = app.emit(
                    &channel,
                    MirrorEvent::Uploaded { rel: f.rel.clone(), index: i + 1, total },
                );
            }
            Err(e) => {
                failed += 1;
                let _ = app.emit(
                    &channel,
                    MirrorEvent::Warning {
                        message: enrich_apply_error(&f.rel, &e),
                    },
                );
            }
        }
    }

    let _ = app.emit(&channel, MirrorEvent::ApplyDone { ok, failed });
    Ok(())
}

#[tauri::command]
pub async fn mirror_cancel(
    app: AppHandle,
    mirror_id: String,
    endpoint: RemoteEndpoint,
    remote_root: String,
    local_root: String,
    snapshot_root: String,
) -> AppResult<()> {
    let _ = endpoint;
    let _ = remote_root;
    let channel = format!("mirror://{mirror_id}/event");

    let status = mirror_diff_status(local_root.clone(), snapshot_root.clone())?;
    let local = PathBuf::from(&local_root);
    let snap = PathBuf::from(&snapshot_root);

    for f in &status {
        let rel_os = norm(&f.rel);
        let local_path = local.join(&rel_os);
        let snap_path = snap.join(&rel_os);
        match f.status {
            "added" => {
                if let Err(e) = std::fs::remove_file(&local_path) {
                    let _ = app.emit(&channel, MirrorEvent::Warning {
                        message: format!("{}: revert (remove) failed: {e}", f.rel),
                    });
                }
            }
            "deleted" => {
                if let Some(parent) = local_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::read(&snap_path) {
                    Ok(bytes) => {
                        if let Err(e) = std::fs::write(&local_path, &bytes) {
                            let _ = app.emit(&channel, MirrorEvent::Warning {
                                message: format!("{}: revert (restore) failed: {e}", f.rel),
                            });
                        }
                    }
                    Err(e) => {
                        let _ = app.emit(&channel, MirrorEvent::Warning {
                            message: format!("{}: snapshot unreadable, cannot restore: {e}", f.rel),
                        });
                    }
                }
            }
            "modified" | _ => {
                match std::fs::read(&snap_path) {
                    Ok(bytes) => {
                        if let Err(e) = std::fs::write(&local_path, &bytes) {
                            let _ = app.emit(&channel, MirrorEvent::Warning {
                                message: format!("{}: revert failed: {e}", f.rel),
                            });
                        }
                    }
                    Err(e) => {
                        let _ = app.emit(&channel, MirrorEvent::Warning {
                            message: format!("{}: snapshot unreadable: {e}", f.rel),
                        });
                    }
                }
            }
        }
    }

    let _ = app.emit(&channel, MirrorEvent::DirtyChanged);
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn walk_rel(root: &Path) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) -> AppResult<()> {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Match the connector-side filter exactly so both walkers see
            // the same files. Otherwise locals see node_modules / .git
            // while remote doesn't, producing fake "local_only" diffs.
            if name == ".snapshot" || name == ".cloudflare-studio-snapshot" {
                continue;
            }
            if cf_tunnel_core::fs_ops::is_skipped(&name) {
                continue;
            }
            let path = entry.path();
            let ft = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_dir() {
                walk(root, &path, out)?;
            } else {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(rel);
            }
        }
        Ok(())
    }
    walk(root, root, &mut out)?;
    out.sort();
    Ok(out)
}

fn file_diff_summary(original: Option<&[u8]>, current_path: &Path) -> (usize, usize, bool) {
    let current = std::fs::read(current_path).unwrap_or_default();
    if looks_binary(&current) || original.map(looks_binary).unwrap_or(false) {
        return (0, 0, true);
    }
    let original_s = String::from_utf8_lossy(original.unwrap_or(&[]));
    let current_s = String::from_utf8_lossy(&current);
    let diff = similar::TextDiff::from_lines(&original_s, &current_s);
    let mut plus = 0;
    let mut minus = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => plus += 1,
            similar::ChangeTag::Delete => minus += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    (plus, minus, false)
}

fn count_lines(b: &[u8]) -> usize {
    b.iter().filter(|c| **c == b'\n').count() + if !b.is_empty() && !b.ends_with(b"\n") { 1 } else { 0 }
}

fn looks_binary(b: &[u8]) -> bool {
    // NUL byte in the first 8 KB is a strong "binary" signal.
    b.iter().take(8192).any(|&c| c == 0)
}

// ── Remote I/O ──────────────────────────────────────────────────────────────

async fn list_remote(endpoint: &RemoteEndpoint, root: &str) -> AppResult<Vec<Entry>> {
    if endpoint.base_url.is_empty() {
        return cf_tunnel_core::fs_ops::walk(Path::new(root));
    }
    let url = format!(
        "{}/files/walk?root={}",
        endpoint.base_url.trim_end_matches('/'),
        urlencoding::encode(root)
    );
    let client = http_client()?;
    let resp = client
        .get(&url)
        .bearer_auth(&endpoint.token)
        .send()
        .await
        .map_err(|e| AppError::Other { message: format!("files/walk: {e}") })?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(AppError::Other { message: format!("files/walk HTTP {s}: {b}") });
    }
    resp.json::<Vec<Entry>>().await.map_err(|e| AppError::Other {
        message: format!("files/walk parse: {e}"),
    })
}

async fn download_remote(endpoint: &RemoteEndpoint, root: &str, rel: &str) -> AppResult<Vec<u8>> {
    if endpoint.base_url.is_empty() {
        return cf_tunnel_core::fs_ops::read_bytes(Path::new(root), rel);
    }
    let url = format!(
        "{}/files/raw?root={}&rel={}",
        endpoint.base_url.trim_end_matches('/'),
        urlencoding::encode(root),
        urlencoding::encode(rel)
    );
    let client = http_client()?;
    let resp = client
        .get(&url)
        .bearer_auth(&endpoint.token)
        .send()
        .await
        .map_err(|e| AppError::Other { message: format!("files/raw: {e}") })?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(AppError::Other { message: format!("files/raw HTTP {s}: {b}") });
    }
    Ok(resp.bytes().await.map_err(|e| AppError::Other {
        message: format!("files/raw body: {e}"),
    })?.to_vec())
}

async fn upload_remote(
    endpoint: &RemoteEndpoint,
    root: &str,
    rel: &str,
    bytes: Vec<u8>,
) -> AppResult<()> {
    if endpoint.base_url.is_empty() {
        return cf_tunnel_core::fs_ops::write_bytes(Path::new(root), rel, &bytes);
    }
    let url = format!(
        "{}/files/raw?root={}&rel={}",
        endpoint.base_url.trim_end_matches('/'),
        urlencoding::encode(root),
        urlencoding::encode(rel)
    );
    let client = http_client()?;
    let resp = client
        .put(&url)
        .bearer_auth(&endpoint.token)
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::Other { message: format!("files/raw upload: {e}") })?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(AppError::Other { message: format!("upload HTTP {s}: {b}") });
    }
    Ok(())
}

async fn delete_remote(endpoint: &RemoteEndpoint, root: &str, rel: &str) -> AppResult<()> {
    if endpoint.base_url.is_empty() {
        return cf_tunnel_core::fs_ops::delete(Path::new(root), rel);
    }
    let url = format!(
        "{}/files/raw?root={}&rel={}",
        endpoint.base_url.trim_end_matches('/'),
        urlencoding::encode(root),
        urlencoding::encode(rel)
    );
    let client = http_client()?;
    let resp = client
        .delete(&url)
        .bearer_auth(&endpoint.token)
        .send()
        .await
        .map_err(|e| AppError::Other { message: format!("files delete: {e}") })?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(AppError::Other { message: format!("delete HTTP {s}: {b}") });
    }
    Ok(())
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Other { message: format!("http client: {e}") })
}

fn mirror_id_for(base_url: &str, remote_root: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    base_url.hash(&mut h);
    remote_root.hash(&mut h);
    format!("m{:016x}", h.finish())
}
