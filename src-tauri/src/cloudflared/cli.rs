use std::path::PathBuf;
use std::process::Command;
use serde::Deserialize;
use crate::db::models::Tunnel;
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

    pub fn list_tunnels(&self) -> AppResult<Vec<Tunnel>> {
        let out = Command::new(&self.path)
            .args(["tunnel", "list", "--output", "json"])
            .output()?;
        if !out.status.success() {
            return Err(AppError::Other {
                message: format!("cloudflared tunnel list failed: {}",
                    String::from_utf8_lossy(&out.stderr))
            });
        }
        parse_tunnel_list_json(&String::from_utf8_lossy(&out.stdout))
    }

    pub fn create_tunnel(&self, name: &str) -> AppResult<Tunnel> {
        let out = Command::new(&self.path)
            .args(["tunnel", "create", "--output", "json", name])
            .output()?;
        if !out.status.success() {
            return Err(AppError::Other {
                message: format!("create tunnel failed: {}",
                    String::from_utf8_lossy(&out.stderr))
            });
        }
        // After create, re-list to find the entry (create JSON output is unreliable across versions)
        let listed = self.list_tunnels()?;
        listed.into_iter()
            .find(|t| t.name == name)
            .ok_or(AppError::Other { message: format!("created tunnel {name} not found in list") })
    }

    pub fn delete_tunnel(&self, uuid: &str) -> AppResult<()> {
        let out = Command::new(&self.path)
            .args(["tunnel", "delete", "-f", uuid])
            .output()?;
        if !out.status.success() {
            return Err(AppError::Other {
                message: format!("delete tunnel failed: {}",
                    String::from_utf8_lossy(&out.stderr))
            });
        }
        Ok(())
    }

    pub fn route_dns(&self, uuid: &str, hostname: &str) -> AppResult<()> {
        let out = Command::new(&self.path)
            .args(["tunnel", "route", "dns", uuid, hostname])
            .output()?;
        if !out.status.success() {
            return Err(AppError::DnsRouteFailed {
                hostname: hostname.into(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct RawTunnel {
    id: String,
    name: String,
    credentials_file: Option<String>,
}

pub fn parse_tunnel_list_json(s: &str) -> AppResult<Vec<Tunnel>> {
    let raw: Vec<RawTunnel> = serde_json::from_str(s)
        .map_err(|e| AppError::Other { message: format!("parse tunnel list: {e}") })?;
    Ok(raw.into_iter().map(|r| Tunnel {
        uuid: r.id,
        name: r.name,
        cred_path: r.credentials_file.unwrap_or_default(),
        managed: false,
        last_seen: chrono_now(),
    }).collect())
}

fn chrono_now() -> String {
    // simple timestamp without pulling chrono — sqlite handles datetime() on writes
    "".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tunnel_list_output() {
        let fixture = r#"[
          {"id":"abc-123","name":"alpha","credentials_file":"/u/.cloudflared/abc-123.json"},
          {"id":"def-456","name":"beta","credentials_file":"/u/.cloudflared/def-456.json"}
        ]"#;
        let out = parse_tunnel_list_json(fixture).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "alpha");
        assert_eq!(out[1].uuid, "def-456");
    }
}
