use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::thread;
use std::net::TcpListener;
use crate::error::{AppError, AppResult};
use crate::supervisor::log_buffer::LogBuffer;

pub struct ManagedProc {
    pub tunnel_uuid: String,
    pub metrics_port: u16,
    pub child: Child,
    pub logs: Arc<LogBuffer>,
}

pub fn alloc_port() -> AppResult<u16> {
    let l = TcpListener::bind("127.0.0.1:0")?;
    Ok(l.local_addr()?.port())
}

pub fn spawn(cloudflared: &std::path::Path, config_path: &std::path::Path, tunnel_uuid: &str)
    -> AppResult<ManagedProc>
{
    let metrics_port = alloc_port()?;
    let logs = Arc::new(LogBuffer::new(2000));

    let mut child = Command::new(cloudflared)
        .args([
            "tunnel",
            "--config", &config_path.to_string_lossy(),
            "--metrics", &format!("127.0.0.1:{metrics_port}"),
            "run",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::ProcSpawnFailed { reason: e.to_string() })?;

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

    Ok(ManagedProc {
        tunnel_uuid: tunnel_uuid.to_string(),
        metrics_port,
        child,
        logs,
    })
}

impl ManagedProc {
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alloc_port_returns_nonzero() {
        let p = alloc_port().unwrap();
        assert!(p > 0);
    }
}
