//! Remote filesystem browser. Used by the manager UI in remote mode to pick
//! a folder on the server (no native picker available over HTTP).

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResult {
    /// Absolute, OS-native path of the listed folder.
    pub path: String,
    /// Parent folder, or null if at a root.
    pub parent: Option<String>,
    /// Entries inside the listed folder. Folders first, then files, both
    /// alphabetically. Hidden + skip-listed entries are filtered out.
    pub entries: Vec<Entry>,
    /// On Windows, the drive roots ("C:\", "D:\", …). Empty on other OSes.
    pub roots: Vec<String>,
    /// Suggested starting points the UI can offer as quick picks.
    pub home: Option<String>,
}

const HIDDEN_DIRS: &[&str] = &[
    "node_modules", ".git", "target", ".cache", ".next", ".turbo", ".wrangler",
    ".svelte-kit", "$RECYCLE.BIN", "System Volume Information",
];

pub fn browse(path: Option<&str>) -> AppResult<BrowseResult> {
    let dir = match path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => start_dir(),
    };

    let canonical = dir.canonicalize().unwrap_or(dir.clone());
    let parent = canonical.parent().map(|p| p.to_string_lossy().to_string());

    let mut entries: Vec<Entry> = Vec::new();
    if canonical.is_dir() {
        let read = std::fs::read_dir(&canonical).map_err(|e| AppError::Other {
            message: format!("read_dir {}: {e}", canonical.display()),
        })?;
        for ent in read.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            // Skip Unix-style hidden dotfiles + heavyweight project caches.
            if name.starts_with('.') || HIDDEN_DIRS.contains(&name.as_str()) {
                continue;
            }
            let ft = match ent.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            entries.push(Entry {
                name,
                path: ent.path().to_string_lossy().to_string(),
                is_dir: ft.is_dir(),
            });
        }
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(BrowseResult {
        path: canonical.to_string_lossy().to_string(),
        parent,
        entries,
        roots: drive_roots(),
        home: dirs::home_dir().map(|p| p.to_string_lossy().to_string()),
    })
}

fn start_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| Path::new(".").to_path_buf())
    })
}

#[cfg(windows)]
fn drive_roots() -> Vec<String> {
    // Probe each letter cheaply via std::fs::metadata. We only return drives
    // we can stat — avoids "A:\\" floppy-drive prompts.
    ('A'..='Z')
        .filter_map(|c| {
            let p = format!("{}:\\", c);
            if std::fs::metadata(&p).is_ok() {
                Some(p)
            } else {
                None
            }
        })
        .collect()
}

#[cfg(not(windows))]
fn drive_roots() -> Vec<String> {
    Vec::new()
}
