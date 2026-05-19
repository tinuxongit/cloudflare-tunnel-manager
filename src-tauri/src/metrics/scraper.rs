use crate::metrics::RuntimeStatus;
use crate::error::{AppError, AppResult};

pub fn parse_prometheus(text: &str) -> RuntimeStatus {
    let mut s = RuntimeStatus { state: "running", ..Default::default() };
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() { continue; }
        let (name_full, value) = match line.rsplit_once(' ') {
            Some(t) => t, None => continue,
        };
        let value: f64 = value.parse().unwrap_or(0.0);
        let name = name_full.split('{').next().unwrap_or(name_full);
        match name {
            "cloudflared_tunnel_active_connections" => s.connections = Some(value as u32),
            "cloudflared_tunnel_total_requests"     => s.requests_per_s = Some(value),
            "cloudflared_tunnel_request_errors"     => s.errors_total = Some(value as u64),
            _ => {}
        }
        // edge region appears as a label on connection metrics:
        // cloudflared_tunnel_connections{edge_region="iad"} 1
        if name_full.starts_with("cloudflared_tunnel_connections") {
            if let Some(start) = name_full.find("edge_region=\"") {
                let rest = &name_full[start + 13..];
                if let Some(end) = rest.find('"') {
                    s.edge_region = Some(rest[..end].to_uppercase());
                }
            }
        }
    }
    s
}

pub async fn fetch(port: u16) -> AppResult<RuntimeStatus> {
    let url = format!("http://127.0.0.1:{port}/metrics");
    let resp = reqwest::Client::new().get(&url).send().await
        .map_err(|_| AppError::MetricsUnreachable { port })?;
    let body = resp.text().await
        .map_err(|_| AppError::MetricsUnreachable { port })?;
    Ok(parse_prometheus(&body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_connections_and_edge() {
        let txt = r#"
# HELP cloudflared_tunnel_active_connections active edge connections
# TYPE cloudflared_tunnel_active_connections gauge
cloudflared_tunnel_active_connections 1
cloudflared_tunnel_connections{edge_region="iad"} 1
cloudflared_tunnel_total_requests 17
cloudflared_tunnel_request_errors 0
"#;
        let s = parse_prometheus(txt);
        assert_eq!(s.connections, Some(1));
        assert_eq!(s.edge_region.as_deref(), Some("IAD"));
        assert_eq!(s.requests_per_s, Some(17.0));
        assert_eq!(s.errors_total, Some(0));
    }
}
