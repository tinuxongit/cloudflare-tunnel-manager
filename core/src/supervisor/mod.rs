pub mod log_buffer;
pub mod proc;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use crate::error::AppResult;
use proc::ManagedProc;

pub struct Supervisor {
    pub cloudflared_path: PathBuf,
    procs: Mutex<HashMap<String, ManagedProc>>, // keyed by tunnel_uuid
}

impl Supervisor {
    pub fn new(cloudflared_path: PathBuf) -> Arc<Self> {
        Arc::new(Self { cloudflared_path, procs: Mutex::new(HashMap::new()) })
    }

    pub fn start(&self, tunnel_uuid: &str, config_path: &std::path::Path) -> AppResult<u16> {
        let mp = proc::spawn(&self.cloudflared_path, config_path, tunnel_uuid)?;
        let port = mp.metrics_port;
        self.procs.lock().insert(tunnel_uuid.into(), mp);
        Ok(port)
    }

    pub fn stop(&self, tunnel_uuid: &str) {
        if let Some(mut p) = self.procs.lock().remove(tunnel_uuid) {
            p.kill();
        }
    }

    pub fn restart(&self, tunnel_uuid: &str, config_path: &std::path::Path) -> AppResult<u16> {
        self.stop(tunnel_uuid);
        self.start(tunnel_uuid, config_path)
    }

    pub fn metrics_port(&self, tunnel_uuid: &str) -> Option<u16> {
        self.procs.lock().get(tunnel_uuid).map(|p| p.metrics_port)
    }

    pub fn logs(&self, tunnel_uuid: &str, last_n: usize) -> Vec<log_buffer::LogLine> {
        self.procs.lock().get(tunnel_uuid)
            .map(|p| p.logs.last(last_n))
            .unwrap_or_default()
    }

    pub fn is_running(&self, tunnel_uuid: &str) -> bool {
        let mut g = self.procs.lock();
        match g.get_mut(tunnel_uuid) {
            Some(p) => p.is_alive(),
            None => false,
        }
    }

    pub fn running_tunnels(&self) -> Vec<String> {
        self.procs.lock().keys().cloned().collect()
    }
}
