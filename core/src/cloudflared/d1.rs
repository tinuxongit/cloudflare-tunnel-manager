//! Cloudflare D1 REST API wrapper.
//! List databases + execute arbitrary SQL. Most-valuable D1 feature is the
//! query console — Cloudflare's dashboard one is awkward; this is the win.

use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};
use super::api::{Credentials, CfEnvelope, http_client, account_id, CF_API_BASE};

#[derive(Debug, Clone, Serialize)]
pub struct D1Database {
    pub uuid: String,
    pub name: String,
    pub version: String,
    pub created_at: String,
    pub file_size: Option<u64>,
    pub num_tables: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct D1QueryResult {
    pub success: bool,
    pub error: Option<String>,
    pub results: Option<Vec<serde_json::Value>>,
    pub meta: Option<D1Meta>,
}

#[derive(Debug, Clone, Serialize)]
pub struct D1Meta {
    pub changes: Option<u64>,
    pub duration: Option<f64>,
    pub rows_read: Option<u64>,
    pub rows_written: Option<u64>,
}

#[derive(Deserialize)]
struct RawDb {
    uuid: String,
    name: String,
    version: String,
    created_at: String,
    file_size: Option<u64>,
    num_tables: Option<u32>,
}

#[derive(Deserialize)]
struct RawQueryEntry {
    success: bool,
    results: Option<Vec<serde_json::Value>>,
    meta: Option<RawMeta>,
}

#[derive(Deserialize)]
struct RawMeta {
    changes: Option<u64>,
    duration: Option<f64>,
    rows_read: Option<u64>,
    rows_written: Option<u64>,
}

pub async fn delete_database(creds: &Credentials, uuid: &str) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/d1/database/{uuid}");
    let resp = creds.apply(client.delete(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("d1 delete: {e}") })?;
    let status = resp.status();
    if !status.is_success() && status.as_u16() != 404 {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Other { message: format!("d1 delete HTTP {status}: {body}") });
    }
    Ok(())
}

pub async fn list_databases(creds: &Credentials) -> AppResult<Vec<D1Database>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/d1/database?per_page=100");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("d1 list: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("d1 list HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Vec<RawDb>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("d1 parse: {e} — body: {body}") })?;
    let raw = env.into_result("d1 list")?;
    Ok(raw.into_iter().map(|r| D1Database {
        uuid: r.uuid, name: r.name, version: r.version, created_at: r.created_at,
        file_size: r.file_size, num_tables: r.num_tables,
    }).collect())
}

pub async fn exec_sql(creds: &Credentials, uuid: &str, sql: &str) -> AppResult<D1QueryResult> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/d1/database/{uuid}/query");
    let body = serde_json::json!({ "sql": sql });
    let resp = creds.apply(client.post(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("d1 query: {e}") })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    // D1 returns a CfEnvelope around an array of per-statement results — most
    // common case is one statement. We surface the first entry's results +
    // meta, and aggregate errors if the envelope failed.
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|_| serde_json::json!({}));
    let envelope_success = parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    if !status.is_success() || !envelope_success {
        let err = parsed.get("errors").and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|e| e.get("message").and_then(|m| m.as_str()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("HTTP {status}: {text}"));
        return Ok(D1QueryResult { success: false, error: Some(err), results: None, meta: None });
    }
    let env: CfEnvelope<Vec<RawQueryEntry>> = serde_json::from_str(&text)
        .map_err(|e| AppError::Other { message: format!("d1 query parse: {e} — body: {text}") })?;
    let entries = env.into_result("d1 query")?;
    let first = entries.into_iter().next();
    match first {
        Some(e) => Ok(D1QueryResult {
            success: e.success,
            error: None,
            results: e.results,
            meta: e.meta.map(|m| D1Meta {
                changes: m.changes, duration: m.duration,
                rows_read: m.rows_read, rows_written: m.rows_written,
            }),
        }),
        None => Ok(D1QueryResult { success: true, error: None, results: Some(vec![]), meta: None }),
    }
}
