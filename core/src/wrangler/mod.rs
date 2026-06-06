//! Wrangler subprocess wrapper. Used by the project-creation pipeline so the
//! user gets a UI experience without ever touching a terminal.
//!
//! Discovery order for the wrangler binary:
//!   1. <project_dir>/node_modules/.bin/wrangler   (preferred — pinned per project)
//!   2. wrangler on PATH                            (fallback — global install)
//!
//! Same for pnpm / npm: PATH lookup. We standardize on pnpm because the
//! existing Cloudflare Studio tooling assumes it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use crate::error::{AppError, AppResult};

/// One line of subprocess output, tagged by stream so the UI can colorize.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "stream", rename_all = "lowercase")]
pub enum CmdLine {
    Stdout { text: String },
    Stderr { text: String },
}

/// Locate wrangler. Project-local first, PATH second.
pub fn locate_wrangler(project_dir: &Path) -> AppResult<PathBuf> {
    let local = project_dir
        .join("node_modules")
        .join(".bin")
        .join(if cfg!(windows) { "wrangler.CMD" } else { "wrangler" });
    if local.exists() { return Ok(local); }

    which::which(if cfg!(windows) { "wrangler.CMD" } else { "wrangler" })
        .or_else(|_| which::which("wrangler"))
        .map_err(|_| AppError::Other {
            message: "wrangler not found. Install Node, then run `pnpm install` in the project folder (the wizard does this for you).".into(),
        })
}

/// Find pnpm on PATH. We use pnpm not npm because the rest of CF Studio
/// standardizes on it; failing fast with a clear message beats a confusing
/// "npm worked but the lockfile is wrong" later.
pub fn locate_pnpm() -> AppResult<PathBuf> {
    which::which(if cfg!(windows) { "pnpm.CMD" } else { "pnpm" })
        .or_else(|_| which::which("pnpm"))
        .map_err(|_| AppError::Other {
            message: "pnpm not found on PATH. Install Node 20+ and pnpm: `npm install -g pnpm`.".into(),
        })
}

/// Check Node is installed by querying `node --version`. Cheap one-shot.
pub async fn check_node() -> AppResult<String> {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let bin = which::which(exe).map_err(|_| AppError::Other {
        message: "Node not found on PATH. Install Node 20+ from https://nodejs.org.".into(),
    })?;
    let out = Command::new(bin).arg("--version").output().await
        .map_err(|e| AppError::Other { message: format!("node --version failed: {e}") })?;
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(v)
}

/// Tools like winget / npm / cargo redraw progress bars by writing
/// `<progress>\r<new progress>` to the SAME line. Our line-reader splits on
/// `\n` only, so a long-running progress bar ends up as one giant line of
/// concatenated `█▒` characters. Splitting on `\r` and dropping empty/repeated
/// progress noise gives the deploy terminal something readable: the final
/// state of each redraw plus actual text output.
fn split_carriage_returns(line: &str) -> Vec<String> {
    if !line.contains('\r') {
        return vec![line.to_string()];
    }
    let mut out = Vec::new();
    let mut last: Option<String> = None;
    for piece in line.split('\r') {
        let trimmed = piece.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        // Skip cosmetic spinner frames ("/", "\", "-", "|") that some
        // installers emit between progress bar redraws.
        if matches!(trimmed, "/" | "\\" | "-" | "|") {
            continue;
        }
        // Suppress duplicate progress-bar lines — only keep the latest state.
        let is_progress = trimmed.chars().any(|c| c == '█' || c == '▒');
        if is_progress {
            last = Some(trimmed.to_string());
        } else {
            if let Some(l) = last.take() {
                out.push(l);
            }
            out.push(trimmed.to_string());
        }
    }
    if let Some(l) = last {
        out.push(l);
    }
    out
}

/// Build the standard Cloudflare env vars for any child process we spawn —
/// wrangler, cloudflared, etc. Picks the saved API token out of the keyring
/// (synced from Studio in remote mode, set locally otherwise) and exposes
/// it as `CLOUDFLARE_API_TOKEN`. Without this, wrangler deploys on a
/// freshly-paired server would fail with "not logged in."
pub fn cf_env_vars() -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    if let Some(token) = crate::secrets::get(crate::secrets::CF_API_TOKEN) {
        out.push(("CLOUDFLARE_API_TOKEN", token));
    }
    out
}

/// Run a command in `cwd`, streaming each output line through `on_line`.
/// Resolves when the process exits. Returns the exit status code; non-zero
/// is propagated as an error so callers don't have to remember to check.
pub async fn run_streaming<F>(
    program: &Path,
    args: &[&str],
    cwd: &Path,
    extra_env: &[(&str, &str)],
    mut on_line: F,
) -> AppResult<()>
where F: FnMut(CmdLine) + Send + 'static {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    // Inject CF auth env unless the caller already set it explicitly.
    let caller_set_token = extra_env.iter().any(|(k, _)| *k == "CLOUDFLARE_API_TOKEN");
    if !caller_set_token {
        for (k, v) in cf_env_vars() {
            cmd.env(k, v);
        }
    }
    for (k, v) in extra_env {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| AppError::Other {
        message: format!("spawn {} failed: {e}", program.display()),
    })?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CmdLine>();
    let tx2 = tx.clone();

    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            for chunk in split_carriage_returns(&line) {
                let _ = tx.send(CmdLine::Stdout { text: chunk });
            }
        }
    });
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            for chunk in split_carriage_returns(&line) {
                let _ = tx2.send(CmdLine::Stderr { text: chunk });
            }
        }
    });

    let pump = tokio::spawn(async move {
        while let Some(line) = rx.recv().await { on_line(line); }
    });

    let status = child.wait().await.map_err(|e| AppError::Other {
        message: format!("wait for {} failed: {e}", program.display()),
    })?;
    let _ = pump.await;

    if !status.success() {
        return Err(AppError::Other {
            message: format!("{} exited with code {}", program.display(), status.code().unwrap_or(-1)),
        });
    }
    Ok(())
}

/// One-shot capture: run a command, collect all output, return as one big
/// String. Used when we need to parse wrangler output (e.g. `d1 create` prints
/// the new database id).
pub async fn run_capture(
    program: &Path,
    args: &[&str],
    cwd: &Path,
    extra_env: &[(&str, &str)],
) -> AppResult<String> {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(cwd).stdin(Stdio::null());
    let caller_set_token = extra_env.iter().any(|(k, _)| *k == "CLOUDFLARE_API_TOKEN");
    if !caller_set_token {
        for (k, v) in cf_env_vars() {
            cmd.env(k, v);
        }
    }
    for (k, v) in extra_env { cmd.env(k, v); }
    let out = cmd.output().await.map_err(|e| AppError::Other {
        message: format!("run {} failed: {e}", program.display()),
    })?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        return Err(AppError::Other {
            message: format!(
                "{} exited with code {}.\nSTDERR:\n{}\nSTDOUT:\n{}",
                program.display(),
                out.status.code().unwrap_or(-1),
                stderr.trim(),
                stdout.trim()
            ),
        });
    }
    Ok(stdout)
}
