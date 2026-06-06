//! Outbound HTTP helpers — the Project view's "Test API" + URL liveness ping.
//! Lives in core so the connector can offer them without re-implementing.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub alive: bool,
    pub status: Option<u16>,
    pub latency_ms: u64,
    pub error: Option<String>,
}

pub async fn ping_url(url: &str) -> AppResult<PingResult> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Other { message: format!("client: {e}") })?;
    let started = std::time::Instant::now();
    let resp = client.get(url).send().await;
    let latency_ms = started.elapsed().as_millis() as u64;
    match resp {
        Ok(r) => {
            let status = r.status().as_u16();
            Ok(PingResult {
                alive: true,
                status: Some(status),
                latency_ms,
                error: None,
            })
        }
        Err(e) => Ok(PingResult {
            alive: false,
            status: None,
            latency_ms,
            error: Some(e.to_string()),
        }),
    }
}

pub async fn http_request(spec: HttpRequestSpec) -> AppResult<HttpResponse> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other { message: format!("client: {e}") })?;
    let method = reqwest::Method::from_bytes(spec.method.to_uppercase().as_bytes())
        .map_err(|e| AppError::Other { message: format!("bad method: {e}") })?;
    let mut req = client.request(method, &spec.url);
    for (k, v) in &spec.headers {
        if !k.trim().is_empty() {
            req = req.header(k, v);
        }
    }
    if let Some(body) = spec.body.filter(|b| !b.is_empty()) {
        req = req.body(body);
    }
    let started = std::time::Instant::now();
    let resp = req.send().await.map_err(|e| AppError::Other {
        message: format!("request: {e}"),
    })?;
    let status = resp.status().as_u16();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.unwrap_or_default();
    let latency_ms = started.elapsed().as_millis() as u64;
    Ok(HttpResponse {
        status,
        headers,
        body,
        latency_ms,
    })
}
