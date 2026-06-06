//! Cloudflare Workers REST API wrapper.
//! Endpoints: list scripts, get script metadata + settings, delete script.
//! Script source deployment is left to wrangler — this UI is for management.

use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};
use super::api::{Credentials, CfEnvelope, http_client, account_id, CF_API_BASE};

#[derive(Debug, Clone, Serialize)]
pub struct Worker {
    pub id: String,
    pub etag: String,
    pub created_on: String,
    pub modified_on: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkerScript {
    pub id: String,
    pub etag: String,
    pub modified_on: String,
    pub compatibility_date: Option<String>,
    pub usage_model: Option<String>,
    pub logpush: Option<bool>,
    pub bindings: Vec<WorkerBinding>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkerBinding {
    pub name: String,
    /// `d1`, `kv_namespace`, `r2_bucket`, `service`, `queue`, `plain_text`, etc.
    pub kind: String,
    /// Short human label, e.g. for D1 the database id, for KV the namespace id.
    pub target: Option<String>,
}

#[derive(Deserialize)]
struct RawWorker {
    id: String,
    etag: String,
    created_on: String,
    modified_on: String,
}

#[derive(Deserialize)]
struct RawSettings {
    #[serde(default)]
    compatibility_date: Option<String>,
    #[serde(default)]
    usage_model: Option<String>,
    #[serde(default)]
    logpush: Option<bool>,
    #[serde(default)]
    bindings: Vec<RawBinding>,
}

/// CF returns bindings as objects whose shape varies by type. We pull a small,
/// common subset and let the UI display the kind + target.
#[derive(Deserialize)]
struct RawBinding {
    name: String,
    #[serde(rename = "type")]
    type_: String,
    // Type-specific id-ish fields. None of them are always present; serde
    // tolerates missing ones via `default`.
    #[serde(default)] database_id: Option<String>,
    #[serde(default)] namespace_id: Option<String>,
    #[serde(default)] bucket_name: Option<String>,
    #[serde(default)] queue_name: Option<String>,
    #[serde(default)] service: Option<String>,
}

impl RawBinding {
    fn target(&self) -> Option<String> {
        self.database_id.clone()
            .or_else(|| self.namespace_id.clone())
            .or_else(|| self.bucket_name.clone())
            .or_else(|| self.queue_name.clone())
            .or_else(|| self.service.clone())
    }
}

pub async fn list_workers(creds: &Credentials) -> AppResult<Vec<Worker>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/scripts");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("workers list: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("workers list HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Vec<RawWorker>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("workers parse: {e} — body: {body}") })?;
    let raw = env.into_result("workers")?;
    Ok(raw.into_iter().map(|r| Worker {
        id: r.id, etag: r.etag, created_on: r.created_on, modified_on: r.modified_on,
    }).collect())
}

pub async fn get_worker(creds: &Credentials, id: &str) -> AppResult<WorkerScript> {
    // Identity fields come from the bulk list; the /settings endpoint
    // doesn't return id/etag/modified_on. Settings adds compat date, usage
    // model, and bindings.
    let acct = account_id(creds).await?;
    let all = list_workers(creds).await?;
    let w = all.into_iter().find(|w| w.id == id)
        .ok_or(AppError::Other { message: format!("worker '{id}' not found in account {acct}") })?;

    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/scripts/{id}/settings");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("worker settings: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    let (compat, usage, logpush, bindings) = if status.is_success() {
        let env: CfEnvelope<RawSettings> = serde_json::from_str(&body)
            .map_err(|e| AppError::Other { message: format!("worker settings parse: {e} — body: {body}") })?;
        let s = env.into_result("worker settings")?;
        let bindings = s.bindings.into_iter().map(|b| WorkerBinding {
            target: b.target(),
            name: b.name,
            kind: b.type_,
        }).collect();
        (s.compatibility_date, s.usage_model, s.logpush, bindings)
    } else {
        // /settings can return 404 on Workers deployed via certain flows.
        // Fall through with empty supplemental data.
        (None, None, None, vec![])
    };

    Ok(WorkerScript {
        id: w.id,
        etag: w.etag,
        modified_on: w.modified_on,
        compatibility_date: compat,
        usage_model: usage,
        logpush,
        bindings,
    })
}

// ── Worker secrets ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct WorkerSecret {
    pub name: String,
    /// Always "secret_text" for now; CF reserves the field for future types.
    pub kind: String,
}

#[derive(Deserialize)]
struct RawSecret {
    name: String,
    #[serde(rename = "type")]
    #[serde(default)]
    type_: Option<String>,
}

pub async fn list_secrets(creds: &Credentials, worker_id: &str) -> AppResult<Vec<WorkerSecret>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/scripts/{worker_id}/secrets");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("secrets list: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("secrets list HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Vec<RawSecret>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("secrets parse: {e} — body: {body}") })?;
    let raw = env.into_result("secrets list")?;
    Ok(raw.into_iter().map(|r| WorkerSecret {
        name: r.name,
        kind: r.type_.unwrap_or_else(|| "secret_text".into()),
    }).collect())
}

pub async fn put_secret(
    creds: &Credentials, worker_id: &str, name: &str, value: &str,
) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/scripts/{worker_id}/secrets");
    let body = serde_json::json!({ "name": name, "text": value, "type": "secret_text" });
    let resp = creds.apply(client.put(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("secret put: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("secret put HTTP {status}: {txt}") });
    }
    Ok(())
}

pub async fn delete_secret(creds: &Credentials, worker_id: &str, name: &str) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/scripts/{worker_id}/secrets/{name}");
    let resp = creds.apply(client.delete(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("secret delete: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("secret delete HTTP {status}: {body}") });
    }
    Ok(())
}

pub async fn delete_worker(creds: &Credentials, id: &str) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    // force=true tells CF to delete even if there are routes/triggers attached.
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/scripts/{id}?force=true");
    let resp = creds.apply(client.delete(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("worker delete: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("worker delete HTTP {status}: {body}") });
    }
    Ok(())
}

