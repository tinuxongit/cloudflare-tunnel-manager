//! Thin wrapper over the Cloudflare REST API (https://api.cloudflare.com/client/v4).
//! Used for read-only zone discovery and DNS record CRUD; tunnel CRUD still
//! goes through the CLI for now.

use serde::{Deserialize, Serialize};
use reqwest::RequestBuilder;
use crate::error::{AppError, AppResult};

const API_BASE: &str = "https://api.cloudflare.com/client/v4";

/// Credentials variant. Bearer = scoped API Token. GlobalKey = legacy
/// X-Auth-Email + X-Auth-Key with full account access.
#[derive(Debug, Clone)]
pub enum Credentials {
    Bearer(String),
    GlobalKey { email: String, key: String },
}

impl Credentials {
    pub fn apply(&self, rb: RequestBuilder) -> RequestBuilder {
        match self {
            Credentials::Bearer(token) => rb.bearer_auth(token),
            Credentials::GlobalKey { email, key } => rb
                .header("X-Auth-Email", email)
                .header("X-Auth-Key", key),
        }
    }
}

/// Resolve the active credential. Prefers a saved API Token; falls back to
/// Global API Key. Returns Err if nothing is configured.
pub fn resolve_credentials() -> AppResult<Credentials> {
    use crate::secrets;
    if let Some(token) = secrets::get(secrets::CF_API_TOKEN) {
        return Ok(Credentials::Bearer(token));
    }
    match (secrets::get(secrets::CF_GLOBAL_EMAIL), secrets::get(secrets::CF_GLOBAL_KEY)) {
        (Some(email), Some(key)) => Ok(Credentials::GlobalKey { email, key }),
        _ => Err(AppError::Other { message: "no Cloudflare credentials configured".into() }),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Zone {
    pub id: String,
    pub name: String,
    pub status: String,
    pub account_name: Option<String>,
}

#[derive(Deserialize)]
struct ListResp<T> {
    result: Option<Vec<T>>,
    success: bool,
    errors: Option<Vec<ApiError>>,
}

#[derive(Deserialize)]
struct ApiError {
    code: u32,
    message: String,
}

#[derive(Deserialize)]
struct RawZone {
    id: String,
    name: String,
    status: String,
    account: Option<RawAccount>,
}

#[derive(Deserialize)]
struct RawAccount {
    name: String,
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Other { message: format!("http client: {e}") })
}

pub async fn list_zones(creds: &Credentials) -> AppResult<Vec<Zone>> {
    let client = http_client()?;
    let mut zones = Vec::new();
    let mut page = 1u32;
    loop {
        let url = format!("{API_BASE}/zones?per_page=50&page={page}");
        let resp = creds.apply(client.get(&url)).send().await
            .map_err(|e| AppError::Other { message: format!("zones request: {e}") })?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::Other {
                message: format!("Cloudflare API {status}: {body}"),
            });
        }
        let parsed: ListResp<RawZone> = serde_json::from_str(&body)
            .map_err(|e| AppError::Other { message: format!("zones parse: {e}") })?;
        if !parsed.success {
            let msg = parsed.errors
                .and_then(|es| es.first().map(|e| format!("{}: {}", e.code, e.message)))
                .unwrap_or_else(|| "unknown CF API error".into());
            return Err(AppError::Other { message: msg });
        }
        let batch = parsed.result.unwrap_or_default();
        if batch.is_empty() { break; }
        let got_full_page = batch.len() == 50;
        for z in batch {
            zones.push(Zone {
                id: z.id,
                name: z.name,
                status: z.status,
                account_name: z.account.map(|a| a.name),
            });
        }
        if !got_full_page { break; }
        page += 1;
        if page > 20 { break; }
    }
    Ok(zones)
}

pub async fn upsert_tunnel_cname(
    creds: &Credentials,
    zone_id: &str,
    hostname: &str,
    tunnel_uuid: &str,
    overwrite: bool,
) -> AppResult<()> {
    let target = format!("{tunnel_uuid}.cfargotunnel.com");
    let client = http_client()?;

    let body = serde_json::json!({
        "type": "CNAME",
        "name": hostname,
        "content": target,
        "proxied": true,
        "ttl": 1,
    });

    let resp = creds.apply(
        client.post(format!("{API_BASE}/zones/{zone_id}/dns_records")).json(&body)
    ).send().await
        .map_err(|e| AppError::Other { message: format!("dns create: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if status.is_success() { return Ok(()); }

    let parsed: serde_json::Value = serde_json::from_str(&txt).unwrap_or(serde_json::json!({}));
    let already_exists = parsed.get("errors")
        .and_then(|v| v.as_array())
        .map(|errs| errs.iter().any(|e| {
            let code = e.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            let msg = e.get("message").and_then(|m| m.as_str()).unwrap_or("");
            code == 81053 || code == 81057
                || msg.to_lowercase().contains("already exists")
                || msg.to_lowercase().contains("identical record")
        }))
        .unwrap_or(false);

    if !already_exists || !overwrite {
        return Err(AppError::DnsRouteFailed {
            hostname: hostname.into(),
            stderr: format!("Cloudflare API HTTP {status}: {txt}"),
        });
    }

    let list_url = format!(
        "{API_BASE}/zones/{zone_id}/dns_records?name={}&match=all",
        urlencode(hostname)
    );
    let list_resp = creds.apply(client.get(&list_url)).send().await
        .map_err(|e| AppError::Other { message: format!("dns list: {e}") })?;
    let list_body = list_resp.text().await.unwrap_or_default();
    let list_parsed: serde_json::Value = serde_json::from_str(&list_body)
        .map_err(|e| AppError::Other { message: format!("dns list parse: {e}") })?;
    let record_id = list_parsed.get("result")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|r| r.get("id"))
        .and_then(|i| i.as_str())
        .ok_or(AppError::DnsRouteFailed {
            hostname: hostname.into(),
            stderr: format!("no record id to overwrite. List response: {list_body}"),
        })?
        .to_string();

    let put_resp = creds.apply(
        client.put(format!("{API_BASE}/zones/{zone_id}/dns_records/{record_id}")).json(&body)
    ).send().await
        .map_err(|e| AppError::Other { message: format!("dns overwrite: {e}") })?;
    let put_status = put_resp.status();
    let put_body = put_resp.text().await.unwrap_or_default();
    if !put_status.is_success() {
        return Err(AppError::DnsRouteFailed {
            hostname: hostname.into(),
            stderr: format!("overwrite HTTP {put_status}: {put_body}"),
        });
    }
    Ok(())
}

fn urlencode(s: &str) -> String {
    s.bytes().flat_map(|b| match b {
        b'.' | b'-' | b'_' | b'~' | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' =>
            vec![b as char],
        _ => format!("%{:02X}", b).chars().collect(),
    }).collect()
}

/// Verify whatever credential is active. For Bearer tokens, hits
/// /user/tokens/verify. For Global API Key, hits /user (which returns
/// 200 + the user object if email + key are valid).
pub async fn verify(creds: &Credentials) -> AppResult<()> {
    let client = http_client()?;
    let url = match creds {
        Credentials::Bearer(_)        => format!("{API_BASE}/user/tokens/verify"),
        Credentials::GlobalKey { .. } => format!("{API_BASE}/user"),
    };
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("verify request: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other {
            message: format!("Cloudflare {url} returned HTTP {status}. Body: {body}"),
        });
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("verify body parse: {e} — body: {body}") })?;
    let success = parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !success {
        let errs = parsed.get("errors").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|e| e.get("message").and_then(|m| m.as_str())).collect::<Vec<_>>().join("; "))
            .unwrap_or_else(|| "(no error message)".into());
        return Err(AppError::Other { message: format!("Cloudflare rejected credential: {errs}") });
    }
    Ok(())
}

// Backwards-compat shims used by older callers.
pub async fn verify_token(token: &str) -> AppResult<()> {
    verify(&Credentials::Bearer(token.to_string())).await
}
