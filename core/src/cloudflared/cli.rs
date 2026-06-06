//! Thin wrapper around the cloudflared binary — only used for discovery +
//! `--version`. Tunnel CRUD and routing now go through the Cloudflare REST
//! API (`crate::cloudflared::api`) so no cert.pem is needed on any host.

use std::path::PathBuf;
use std::process::Command;
use crate::error::{AppError, AppResult};

pub struct CloudflaredCli {
    pub path: PathBuf,
}

impl CloudflaredCli {
    pub fn discover() -> AppResult<Self> {
        let path = which::which("cloudflared")
            .map_err(|_| AppError::CloudflaredNotFound)?;
        Ok(Self { path })
    }

    pub fn with_path(path: PathBuf) -> Self { Self { path } }

    pub fn version(&self) -> AppResult<String> {
        let out = Command::new(&self.path).arg("--version").output()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        // sample: "cloudflared version 2025.8.1 (built 2025-08-21-1534 UTC)"
        Ok(s)
    }
}
