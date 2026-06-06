//! Project-folder file editor (list / read / write). Path-traversal hardened
//! via canonicalize-then-prefix-check. Shared between Tauri and connector.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "dist", "target", ".wrangler", ".turbo", ".next",
    ".svelte-kit", ".cache",
];

pub fn list(folder: &Path) -> AppResult<Vec<String>> {
    if !folder.exists() {
        return Err(AppError::Other {
            message: format!("folder doesn't exist: {}", folder.display()),
        });
    }
    let mut out = Vec::new();
    walk_files(folder, folder, &mut out, 0)?;
    out.sort();
    Ok(out)
}

fn walk_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<String>,
    depth: usize,
) -> AppResult<()> {
    if depth > 6 {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| AppError::Other {
        message: format!("read_dir {}: {e}", dir.display()),
    })? {
        let entry = entry.map_err(|e| AppError::Other { message: e.to_string() })?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let ft = entry
            .file_type()
            .map_err(|e| AppError::Other { message: e.to_string() })?;
        if ft.is_dir() {
            walk_files(root, &path, out, depth + 1)?;
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

pub fn read(folder: &Path, rel: &str) -> AppResult<String> {
    let p = safe_join(folder, rel)?;
    std::fs::read_to_string(&p).map_err(|e| AppError::Other {
        message: format!("read {}: {e}", p.display()),
    })
}

pub fn write(folder: &Path, rel: &str, content: &str) -> AppResult<()> {
    let p = safe_join(folder, rel)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Other {
            message: format!("mkdir {}: {e}", parent.display()),
        })?;
    }
    std::fs::write(&p, content).map_err(|e| AppError::Other {
        message: format!("write {}: {e}", p.display()),
    })?;
    Ok(())
}

fn safe_join(folder: &Path, rel: &str) -> AppResult<PathBuf> {
    let root = folder.canonicalize().map_err(|e| AppError::Other {
        message: format!("canonicalize {}: {e}", folder.display()),
    })?;
    let cleaned = rel.replace('\\', "/");
    if cleaned.split('/').any(|c| c == "..") {
        return Err(AppError::Other {
            message: "path traversal not allowed".into(),
        });
    }
    let joined = root.join(&cleaned);
    let canonical = if joined.exists() {
        joined.canonicalize().map_err(|e| AppError::Other {
            message: format!("canonicalize {}: {e}", joined.display()),
        })?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| AppError::Other { message: "no parent".into() })?;
        let cp = if parent.exists() {
            parent.canonicalize().map_err(|e| AppError::Other {
                message: format!("canonicalize parent: {e}"),
            })?
        } else {
            parent.to_path_buf()
        };
        cp.join(joined.file_name().unwrap_or_default())
    };
    if !canonical.starts_with(&root) {
        return Err(AppError::Other {
            message: "path escapes project folder".into(),
        });
    }
    Ok(canonical)
}
