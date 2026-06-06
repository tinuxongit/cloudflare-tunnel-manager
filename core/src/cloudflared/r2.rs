//! Cloudflare R2 bucket management.
//! Object-level CRUD requires S3-compatible signing (separate access keys),
//! so we ship bucket-level only for now: list, create, delete, info.

use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};
use super::api::{Credentials, CfEnvelope, http_client, account_id, CF_API_BASE};

#[derive(Debug, Clone, Serialize)]
pub struct R2Bucket {
    pub name: String,
    pub creation_date: String,
    pub location: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Deserialize)]
struct RawBucketsResp {
    buckets: Vec<RawBucket>,
}
#[derive(Deserialize)]
struct RawBucket {
    name: String,
    creation_date: String,
    #[serde(default)]
    location: Option<String>,
    #[serde(default)]
    storage_class: Option<String>,
}

pub async fn list_buckets(creds: &Credentials) -> AppResult<Vec<R2Bucket>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/r2/buckets");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("r2 list: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("r2 list HTTP {status}: {body}") });
    }
    let env: CfEnvelope<RawBucketsResp> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("r2 parse: {e} — body: {body}") })?;
    let raw = env.into_result("r2 list")?;
    Ok(raw.buckets.into_iter().map(|b| R2Bucket {
        name: b.name,
        creation_date: b.creation_date,
        location: b.location,
        storage_class: b.storage_class,
    }).collect())
}

pub async fn create_bucket(creds: &Credentials, name: &str) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/r2/buckets");
    let body = serde_json::json!({ "name": name });
    let resp = creds.apply(client.post(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("r2 create: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("r2 create HTTP {status}: {txt}") });
    }
    Ok(())
}

pub async fn delete_bucket(creds: &Credentials, name: &str) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/r2/buckets/{name}");
    let resp = creds.apply(client.delete(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("r2 delete: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("r2 delete HTTP {status}: {body}") });
    }
    Ok(())
}
