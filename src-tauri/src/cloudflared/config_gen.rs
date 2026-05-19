use serde::Serialize;
use std::path::{Path, PathBuf};
use crate::db::models::Page;
use crate::error::{AppError, AppResult};

#[derive(Serialize)]
struct ConfigFile {
    tunnel: String,
    #[serde(rename = "credentials-file")]
    credentials_file: String,
    protocol: String,
    #[serde(rename = "ha-connections")]
    ha_connections: u32,
    ingress: Vec<IngressRule>,
}

#[derive(Serialize)]
struct IngressRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    hostname: Option<String>,
    service: String,
}

pub fn build_yaml(tunnel_uuid: &str, cred_path: &str, enabled_pages: &[Page]) -> String {
    let mut ingress: Vec<IngressRule> = enabled_pages.iter().map(|p| IngressRule {
        hostname: Some(p.hostname.clone()),
        service: p.service_url.clone(),
    }).collect();
    ingress.push(IngressRule { hostname: None, service: "http_status:404".into() });

    let cfg = ConfigFile {
        tunnel: tunnel_uuid.to_string(),
        credentials_file: cred_path.to_string(),
        protocol: "http2".into(),
        ha_connections: 1,
        ingress,
    };
    serde_yaml::to_string(&cfg).unwrap()
}

pub fn write_yaml(dir: &Path, tunnel_uuid: &str, yaml: &str) -> AppResult<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{tunnel_uuid}.yml"));
    std::fs::write(&path, yaml).map_err(|e| AppError::ConfigWriteFailed {
        path: path.display().to_string(),
        reason: e.to_string(),
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Page;

    fn page(id: i64, host: &str, port: u16) -> Page {
        Page { id, hostname: host.into(), service_url: format!("http://localhost:{port}"),
               tunnel_uuid: "uuid-1".into(), enabled: true, created_at: "".into() }
    }

    #[test]
    fn yaml_contains_ingress_rules_and_terminal_404() {
        let pages = vec![page(1, "a.com", 3000), page(2, "b.com", 3100)];
        let y = build_yaml("uuid-1", "/c/cred.json", &pages);
        assert!(y.contains("tunnel: uuid-1"));
        assert!(y.contains("hostname: a.com"));
        assert!(y.contains("hostname: b.com"));
        assert!(y.contains("http_status:404"));
        assert!(y.contains("http2"));
    }

    #[test]
    fn empty_pages_yields_only_terminal_rule() {
        let y = build_yaml("u", "c", &[]);
        let count = y.matches("- ").count();
        assert_eq!(count, 1, "expected only terminal 404 rule, got: {y}");
    }
}
