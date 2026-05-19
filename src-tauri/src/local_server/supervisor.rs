//! Tracks per-page local servers. Two flavours:
//!  - External child process (Node, Python, Go binary, etc.) — direct exec,
//!    no cmd.exe/sh wrapper.
//!  - In-process static file server (axum + ServeDir) for static folders,
//!    replacing the `npx serve` Node hit.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::sync::Arc;
use std::thread;
use parking_lot::Mutex;

use crate::error::{AppError, AppResult};
use crate::supervisor::log_buffer::LogBuffer;
use crate::local_server::static_server::{self, StaticServerHandle};

pub struct LocalProc {
    pub page_id: i64,
    pub port: u16,
    pub child: Child,
    pub logs: Arc<LogBuffer>,
}

impl LocalProc {
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

pub enum ProcEntry {
    Child(LocalProc),
    Static { page_id: i64, port: u16, handle: Option<StaticServerHandle>, logs: Arc<LogBuffer> },
}

impl ProcEntry {
    pub fn port(&self) -> u16 {
        match self {
            ProcEntry::Child(p) => p.port,
            ProcEntry::Static { port, .. } => *port,
        }
    }
    pub fn is_alive(&mut self) -> bool {
        match self {
            ProcEntry::Child(p) => p.is_alive(),
            ProcEntry::Static { handle, .. } => handle.is_some(),
        }
    }
    pub fn logs(&self) -> Arc<LogBuffer> {
        match self {
            ProcEntry::Child(p) => p.logs.clone(),
            ProcEntry::Static { logs, .. } => logs.clone(),
        }
    }
    pub fn kill(&mut self) {
        match self {
            ProcEntry::Child(p) => p.kill(),
            ProcEntry::Static { handle, .. } => {
                if let Some(h) = handle.take() { static_server::shutdown(h); }
            }
        }
    }
}

pub struct LocalSupervisor {
    procs: Mutex<HashMap<i64, ProcEntry>>,
}

impl LocalSupervisor {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { procs: Mutex::new(HashMap::new()) })
    }

    pub fn alloc_port(&self) -> AppResult<u16> {
        let l = TcpListener::bind("127.0.0.1:0")?;
        Ok(l.local_addr()?.port())
    }

    /// Spawn an external command as a child process. Resolves the executable
    /// against PATH; if it ends in `.cmd`/`.bat` (Windows shims like `npm`,
    /// `npx`, `pnpm`) routes through cmd.exe automatically. Otherwise runs
    /// the binary directly — no shell middleman.
    pub fn start_external(&self, page_id: i64, dir: &Path, command_template: &str, port: u16)
        -> AppResult<u16>
    {
        {
            let mut g = self.procs.lock();
            if let Some(p) = g.get_mut(&page_id) {
                if p.is_alive() { return Ok(p.port()); }
                g.remove(&page_id);
            }
        }

        let cmd_str = command_template.replace("{PORT}", &port.to_string());
        let mut argv = split_argv(&cmd_str);
        if argv.is_empty() {
            return Err(AppError::ProcSpawnFailed { reason: "empty command".into() });
        }

        let logs = Arc::new(LogBuffer::new(2000));

        let needs_shell = needs_shell_for(&argv[0]) || command_has_shell_syntax(&cmd_str);
        let mut cmd = if needs_shell {
            #[cfg(windows)] {
                let mut c = Command::new("cmd");
                c.args(["/C", &cmd_str]);
                c
            }
            #[cfg(not(windows))] {
                let mut c = Command::new("sh");
                c.args(["-c", &cmd_str]);
                c
            }
        } else {
            let exe = argv.remove(0);
            let mut c = Command::new(exe);
            c.args(&argv);
            c
        };

        cmd.current_dir(dir)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| AppError::ProcSpawnFailed {
            reason: format!("spawn `{cmd_str}` in {}: {e}", dir.display())
        })?;

        if let Some(out) = child.stdout.take() {
            let logs = logs.clone();
            thread::spawn(move || {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    logs.push("stdout", line);
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            let logs = logs.clone();
            thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    logs.push("stderr", line);
                }
            });
        }

        self.procs.lock().insert(page_id, ProcEntry::Child(LocalProc {
            page_id, port, child, logs,
        }));
        Ok(port)
    }

    /// Spin up an in-process axum static-file server for the given folder.
    /// Avoids the npx serve cost entirely (~150 MB savings vs spawning Node).
    pub async fn start_static(&self, page_id: i64, dir: &Path, port: u16) -> AppResult<u16> {
        self.stop(page_id);
        let logs = Arc::new(LogBuffer::new(64));
        logs.push("stdout", format!("[embedded-static] serving {} on 127.0.0.1:{port}", dir.display()));
        let h = static_server::spawn(PathBuf::from(dir), port).await
            .map_err(|e| AppError::ProcSpawnFailed { reason: format!("static server: {e}") })?;
        self.procs.lock().insert(page_id, ProcEntry::Static {
            page_id, port, handle: Some(h), logs,
        });
        Ok(port)
    }

    pub fn stop(&self, page_id: i64) {
        if let Some(mut p) = self.procs.lock().remove(&page_id) {
            p.kill();
        }
    }

    pub fn is_running(&self, page_id: i64) -> bool {
        let mut g = self.procs.lock();
        match g.get_mut(&page_id) {
            Some(p) => p.is_alive(),
            None    => false,
        }
    }

    pub fn logs(&self, page_id: i64, last_n: usize)
        -> Vec<crate::supervisor::log_buffer::LogLine>
    {
        self.procs.lock().get(&page_id)
            .map(|p| p.logs().last(last_n))
            .unwrap_or_default()
    }

    pub fn port_of(&self, page_id: i64) -> Option<u16> {
        self.procs.lock().get(&page_id).map(|p| p.port())
    }
}

// --- helpers ---------------------------------------------------------------

/// Naive arg splitter — splits on whitespace, respects double-quoted segments.
/// Good enough for typical run commands like `node server.js`, `python main.py`,
/// `uvicorn main:app --host 127.0.0.1 --port {PORT}`.
fn split_argv(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for ch in s.chars() {
        if ch == '"' { in_quotes = !in_quotes; continue; }
        if ch.is_whitespace() && !in_quotes {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() { out.push(cur); }
    out
}

/// True if the command name is a Windows batch shim (npm, npx, pnpm, yarn etc.)
/// — these must run through cmd.exe to resolve the .cmd suffix on PATH.
fn needs_shell_for(exe: &str) -> bool {
    #[cfg(not(windows))] { let _ = exe; return false; }
    #[cfg(windows)] {
        let lower = exe.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".ps1") {
            return true;
        }
        matches!(lower.as_str(),
            "npm" | "npx" | "pnpm" | "yarn" | "yarn.cmd" |
            "node-gyp" | "tsc" | "vite" | "next" | "nuxt"
        )
    }
}

fn command_has_shell_syntax(cmd: &str) -> bool {
    cmd.contains("&&") || cmd.contains("||") || cmd.contains(';')
        || cmd.contains('|') || cmd.contains('>') || cmd.contains('<')
}
