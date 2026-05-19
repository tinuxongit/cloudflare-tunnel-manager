//! Thin wrapper over the Cloudflare REST API (https://api.cloudflare.com/client/v4).
//! Used only for read-only zone discovery; tunnel CRUD still goes through the CLI.

use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};

const API_BASE: &str = "https://api.cloudflare.com/client/v4";

#[derive(Debug, Clone, Serialize)]
pub struct Zone {
    pub id: String,
    pub name: String,         // e.g. "alpha.com"
    pub status: String,       // "active" | "pending" | ...
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

pub async fn list_zones(token: &str) -> AppResult<Vec<Zone>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Other { message: format!("http client: {e}") })?;

    let mut zones = Vec::new();
    let mut page = 1u32;
    loop {
        let url = format!("{API_BASE}/zones?per_page=50&page={page}");
        let resp = client.get(&url)
            .bearer_auth(token)
            .send().await
            .map_err(|e| AppError::Other { message: format!("zones request: {e}") })?;
        let status = resp.status();
        let body = resp.text().await
            .map_err(|e| AppError::Other { message: format!("zones body: {e}") })?;
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
        if page > 20 { break; } // safety cap: 1000 zones
    }
    Ok(zones)
}

pub async fn verify_token(token: &str) -> AppResult<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Other { message: format!("http client: {e}") })?;
    let resp = client.get(format!("{API_BASE}/user/tokens/verify"))
        .bearer_auth(token)
        .send().await
        .map_err(|e| AppError::Other { message: format!("verify request: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other {
            message: format!("Cloudflare /user/tokens/verify returned HTTP {status}. Body: {body}"),
        });
    }
    // CF returns 200 with {"success": bool, "errors": [...]} — must check success flag too.
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("verify body parse: {e} — body was: {body}") })?;
    let success = parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !success {
        let errs = parsed.get("errors").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|e| e.get("message").and_then(|m| m.as_str())).collect::<Vec<_>>().join("; "))
            .unwrap_or_else(|| "(no error message)".into());
        return Err(AppError::Other {
            message: format!("Cloudflare rejected token: {errs}"),
        });
    }
    Ok(())
}
