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

    pub fn route_dns(&self, uuid: &str, hostname: &str, overwrite: bool) -> AppResult<()> {
        let mut args: Vec<&str> = vec!["tunnel", "route", "dns"];
        if overwrite { args.push("--overwrite-dns"); }
        args.push(uuid);
        args.push(hostname);
        let out = Command::new(&self.path).args(&args).output()?;
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

#[derive(Deserialize)]
struct WrappedList {
    value: Vec<RawTunnel>,
}

/// Resolve credentials path for a tunnel UUID.
/// cloudflared 2024+ no longer emits `credentials_file` in `tunnel list --output json`.
/// Fall back to the standard `<home>/.cloudflared/<uuid>.json` location.
fn default_cred_path(uuid: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".cloudflared").join(format!("{uuid}.json"));
        if p.exists() {
            return p.display().to_string();
        }
        // Return the expected path even if missing — error message later will be useful.
        return p.display().to_string();
    }
    format!(".cloudflared/{uuid}.json")
}

pub fn parse_tunnel_list_json(s: &str) -> AppResult<Vec<Tunnel>> {
    // cloudflared may emit log lines (e.g. "outdated version" warning) to stdout
    // before the actual JSON payload. Skip lines until we find one starting with
    // '[' (legacy raw array) or '{' (wrapped object).
    let payload = s.lines()
        .skip_while(|l| !l.trim_start().starts_with('[') && !l.trim_start().starts_with("{\"value\""))
        .collect::<Vec<_>>()
        .join("\n");
    let payload = if payload.is_empty() { s } else { &payload };

    let raw: Vec<RawTunnel> = if let Ok(arr) = serde_json::from_str::<Vec<RawTunnel>>(payload) {
        arr
    } else if let Ok(wrapped) = serde_json::from_str::<WrappedList>(payload) {
        wrapped.value
    } else {
        // Try harder: take everything from the first '[' or '{' to the end.
        let start = payload.find('[').or_else(|| payload.find('{'));
        if let Some(i) = start {
            let slice = &payload[i..];
            serde_json::from_str::<Vec<RawTunnel>>(slice)
                .or_else(|_| serde_json::from_str::<WrappedList>(slice).map(|w| w.value))
                .map_err(|e| AppError::Other { message: format!("parse tunnel list: {e}") })?
        } else {
            return Err(AppError::Other { message: "tunnel list: no JSON payload found".into() });
        }
    };

    Ok(raw.into_iter().map(|r| {
        let cred_path = r.credentials_file
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| default_cred_path(&r.id));
        Tunnel {
            uuid: r.id,
            name: r.name,
            cred_path,
            managed: false,
            last_seen: chrono_now(),
        }
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

    #[test]
    fn parse_wrapped_list_with_log_prefix() {
        // Real cloudflared 2025.8.1+ output: warn line on stdout, then wrapped object.
        let fixture = r#"{"level":"warn","message":"Your version 2025.8.1 is outdated"}
{"value":[{"id":"56ae32ca-b365-4fea-99a9-88059c64bab6","name":"Alpha","created_at":"2026-05-19T13:43:38Z","connections":[]}],"Count":1}"#;
        let out = parse_tunnel_list_json(fixture).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Alpha");
        assert_eq!(out[0].uuid, "56ae32ca-b365-4fea-99a9-88059c64bab6");
        // cred_path falls back to ~/.cloudflared/<uuid>.json
        assert!(out[0].cred_path.ends_with("56ae32ca-b365-4fea-99a9-88059c64bab6.json"));
    }
}
