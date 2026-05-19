//! Tracks user-app processes (Node/Python/static-server) launched per page.
//! Spawn = blocking; killing = best-effort. Log lines captured to a ring buffer.

use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::sync::Arc;
use std::thread;
use parking_lot::Mutex;

use crate::error::{AppError, AppResult};
use crate::supervisor::log_buffer::LogBuffer;

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

pub struct LocalSupervisor {
    procs: Mutex<HashMap<i64, LocalProc>>,
}

impl LocalSupervisor {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { procs: Mutex::new(HashMap::new()) })
    }

    pub fn alloc_port(&self) -> AppResult<u16> {
        let l = TcpListener::bind("127.0.0.1:0")?;
        Ok(l.local_addr()?.port())
    }

    /// Start a process for `page_id` in `dir` running `command_template` (with
    /// `{PORT}` placeholder replaced by the assigned port). Returns the port.
    /// If a process is already running for this page, no-ops and returns its port.
    pub fn start(&self, page_id: i64, dir: &Path, command_template: &str, port: u16)
        -> AppResult<u16>
    {
        {
            let mut g = self.procs.lock();
            if let Some(p) = g.get_mut(&page_id) {
                if p.is_alive() { return Ok(p.port); }
                // dead — drop and re-spawn below
                g.remove(&page_id);
            }
        }

        let command = command_template.replace("{PORT}", &port.to_string());
        let logs = Arc::new(LogBuffer::new(2000));

        // Run via cmd.exe on Windows so `npm start`, `npx serve`, etc. resolve
        // to the npm/python shim on PATH (these are .cmd files on Win).
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", &command]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", &command]);
            c
        };

        cmd.current_dir(dir)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn()
            .map_err(|e| AppError::ProcSpawnFailed {
                reason: format!("spawn `{command}` in {}: {e}", dir.display())
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

        self.procs.lock().insert(page_id, LocalProc {
            page_id, port, child, logs,
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
            .map(|p| p.logs.last(last_n))
            .unwrap_or_default()
    }

    pub fn port_of(&self, page_id: i64) -> Option<u16> {
        self.procs.lock().get(&page_id).map(|p| p.port)
    }
}
