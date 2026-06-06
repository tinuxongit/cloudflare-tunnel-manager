//! Generic filesystem ops on the connector side. Same path-traversal hardening
//! as `projects::files` but scoped to whatever root the caller supplies — used
//! by the file mirror feature so any folder on the server can be browsed +
//! edited from Studio, not just project folders.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix timestamp (seconds) of last modification. Used by the mirror
    /// walker to skip files that haven't changed since last sync.
    pub mtime_secs: i64,
}

/// Directories we never traverse on either side. Mostly heavy build artifacts
/// and version-control internals — pulling them over the tunnel would explode
/// the snapshot and clutter every diff. User dotfiles (`.env`, `.htaccess`,
/// `.editorconfig`) are NOT in this list and are walked normally.
pub const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "dist", "target", "build", "out",
    ".wrangler", ".turbo", ".next", ".svelte-kit", ".cache",
    ".idea", ".vscode", "__pycache__",
];

/// Specific noisy files we always skip (OS-generated junk, never wanted in a
/// website diff).
pub const SKIP_FILES: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini"];

/// True if a file or directory name should be excluded from walks.
pub fn is_skipped(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || SKIP_FILES.contains(&name)
}

/// Walk `root` recursively, yielding metadata for every file and folder.
/// Skips heavy build-artifact directories so mirroring a project doesn't
/// pull node_modules over the tunnel. Keeps user dotfiles (`.htaccess`,
/// `.env`, `.gitignore`, etc.) — those are part of the project.
pub fn walk(root: &Path) -> AppResult<Vec<Entry>> {
    if !root.exists() {
        return Err(AppError::Other {
            message: format!("folder doesn't exist: {}", root.display()),
        });
    }
    let mut out = Vec::new();
    walk_inner(root, root, &mut out, 0)?;
    Ok(out)
}

fn walk_inner(root: &Path, dir: &Path, out: &mut Vec<Entry>, depth: usize) -> AppResult<()> {
    if depth > 12 {
        return Ok(());
    }
    let read = std::fs::read_dir(dir).map_err(|e| AppError::Other {
        message: format!("read_dir {}: {e}", dir.display()),
    })?;
    for entry in read {
        let entry = entry.map_err(|e| AppError::Other { message: e.to_string() })?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_skipped(&name) {
            continue;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let mtime_secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let is_dir = meta.is_dir();
        out.push(Entry {
            name: name.clone(),
            rel,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            mtime_secs,
        });
        if is_dir {
            walk_inner(root, &path, out, depth + 1)?;
        }
    }
    Ok(())
}

/// Bytes of a file at `rel` inside `root`. Path-traversal hardened.
pub fn read_bytes(root: &Path, rel: &str) -> AppResult<Vec<u8>> {
    let p = safe_join(root, rel)?;
    std::fs::read(&p).map_err(|e| AppError::Other {
        message: format!("read {}: {e}", p.display()),
    })
}

pub fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) -> AppResult<()> {
    let p = safe_join(root, rel)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Other {
            message: format!("mkdir {}: {e}", parent.display()),
        })?;
    }
    std::fs::write(&p, bytes).map_err(|e| AppError::Other {
        message: format!("write {}: {e}", p.display()),
    })
}

pub fn mkdir(root: &Path, rel: &str) -> AppResult<()> {
    let p = safe_join(root, rel)?;
    std::fs::create_dir_all(&p).map_err(|e| AppError::Other {
        message: format!("mkdir {}: {e}", p.display()),
    })
}

pub fn delete(root: &Path, rel: &str) -> AppResult<()> {
    let p = safe_join(root, rel)?;
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    }
    .map_err(|e| AppError::Other {
        message: format!("delete {}: {e}", p.display()),
    })
}

pub fn rename(root: &Path, from_rel: &str, to_rel: &str) -> AppResult<()> {
    let from = safe_join(root, from_rel)?;
    let to = safe_join(root, to_rel)?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Other {
            message: format!("mkdir {}: {e}", parent.display()),
        })?;
    }
    std::fs::rename(&from, &to).map_err(|e| AppError::Other {
        message: format!("rename {} -> {}: {e}", from.display(), to.display()),
    })
}

fn safe_join(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let root_can = root.canonicalize().map_err(|e| AppError::Other {
        message: format!("canonicalize {}: {e}", root.display()),
    })?;
    let cleaned = rel.replace('\\', "/");
    if cleaned.split('/').any(|c| c == "..") {
        return Err(AppError::Other {
            message: "path traversal not allowed".into(),
        });
    }
    let joined = root_can.join(&cleaned);
    let canonical = if joined.exists() {
        joined.canonicalize().map_err(|e| AppError::Other {
            message: format!("canonicalize {}: {e}", joined.display()),
        })?
    } else {
        let parent = joined.parent().ok_or_else(|| AppError::Other {
            message: "no parent".into(),
        })?;
        let cp = if parent.exists() {
            parent.canonicalize().map_err(|e| AppError::Other {
                message: format!("canonicalize parent: {e}"),
            })?
        } else {
            parent.to_path_buf()
        };
        cp.join(joined.file_name().unwrap_or_default())
    };
    if !canonical.starts_with(&root_can) {
        return Err(AppError::Other {
            message: "path escapes root".into(),
        });
    }
    Ok(canonical)
}
