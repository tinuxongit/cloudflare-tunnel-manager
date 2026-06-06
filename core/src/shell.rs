//! Cross-platform shell ops: open folder in file manager, open in editor,
//! delete a folder recursively. Lives in core so both Tauri (local) and
//! the connector (remote) share one implementation.

use std::path::Path;

use crate::error::{AppError, AppResult};

/// Open a folder in the OS file manager. No-op error on headless Linux —
/// we still return Ok so a remote UI doesn't surface "explorer not found"
/// for a benign action.
pub fn open_folder(path: &str) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Other { message: format!("explorer: {e}") })?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Other { message: format!("open: {e}") })?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Other { message: format!("xdg-open: {e}") })?;
    }
    Ok(())
}

/// Open a folder in an installed code editor. Prefers Cursor, falls back to
/// VS Code, then to the OS file manager so the click always does something.
pub fn open_in_editor(path: &str) -> AppResult<()> {
    let candidates: &[&str] = if cfg!(windows) {
        &["cursor.cmd", "cursor", "code.cmd", "code"]
    } else {
        &["cursor", "code"]
    };
    for name in candidates {
        if let Ok(exe) = which::which(name) {
            std::process::Command::new(&exe)
                .arg(path)
                .spawn()
                .map_err(|e| AppError::Other { message: format!("{}: {e}", exe.display()) })?;
            return Ok(());
        }
    }
    open_folder(path)
}

/// Recursively delete a folder. Refuses to touch a root-like path.
pub fn delete_folder(folder: &str) -> AppResult<()> {
    let p = Path::new(folder);
    if !p.exists() {
        return Ok(());
    }
    if p.parent().is_none() {
        return Err(AppError::Other {
            message: format!("refusing to delete root-like path: {folder}"),
        });
    }
    std::fs::remove_dir_all(p).map_err(|e| AppError::Other {
        message: format!("delete folder failed: {e}"),
    })
}
