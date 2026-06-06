//! General DNS record CRUD. The CNAME-for-tunnel logic in api.rs handles the
//! specific "create-or-overwrite for a tunnel" flow; this is the broader
//! interface for arbitrary record types.

use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};
use super::api::{Credentials, CfEnvelope, http_client, CF_API_BASE};

#[derive(Debug, Clone, Serialize)]
pub struct DnsRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub name: String,
    pub content: String,
    pub ttl: u32,
    pub proxied: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewDnsRecord {
    #[serde(rename = "type")]
    pub type_: String,
    pub name: String,
    pub content: String,
    pub ttl: u32,
    pub proxied: bool,
}

#[derive(Deserialize)]
struct RawRecord {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    name: String,
    content: String,
    #[serde(default = "default_ttl")]
    ttl: u32,
    #[serde(default)]
    proxied: bool,
}

fn default_ttl() -> u32 { 1 }

pub async fn list_records(creds: &Credentials, zone_id: &str) -> AppResult<Vec<DnsRecord>> {
    let client = http_client()?;
    let mut all = Vec::new();
    let mut page = 1u32;
    loop {
        let url = format!("{CF_API_BASE}/zones/{zone_id}/dns_records?per_page=100&page={page}");
        let resp = creds.apply(client.get(&url)).send().await
            .map_err(|e| AppError::Other { message: format!("dns list: {e}") })?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::Other { message: format!("dns list HTTP {status}: {body}") });
        }
        let env: CfEnvelope<Vec<RawRecord>> = serde_json::from_str(&body)
            .map_err(|e| AppError::Other { message: format!("dns parse: {e} — body: {body}") })?;
        let batch = env.into_result("dns list")?;
        let got_full_page = batch.len() == 100;
        for r in batch {
            all.push(DnsRecord {
                id: r.id, type_: r.type_, name: r.name, content: r.content,
                ttl: r.ttl, proxied: r.proxied,
            });
        }
        if !got_full_page { break; }
        page += 1;
        if page > 20 { break; }
    }
    Ok(all)
}

pub async fn create_record(
    creds: &Credentials, zone_id: &str, record: &NewDnsRecord,
) -> AppResult<DnsRecord> {
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/zones/{zone_id}/dns_records");
    let body = serde_json::json!({
        "type": record.type_,
        "name": record.name,
        "content": record.content,
        "ttl": record.ttl,
        "proxied": record.proxied,
    });
    let resp = creds.apply(client.post(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("dns create: {e}") })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("dns create HTTP {status}: {text}") });
    }
    let env: CfEnvelope<RawRecord> = serde_json::from_str(&text)
        .map_err(|e| AppError::Other { message: format!("dns create parse: {e} — body: {text}") })?;
    let r = env.into_result("dns create")?;
    Ok(DnsRecord {
        id: r.id, type_: r.type_, name: r.name, content: r.content,
        ttl: r.ttl, proxied: r.proxied,
    })
}

pub async fn delete_record(creds: &Credentials, zone_id: &str, record_id: &str) -> AppResult<()> {
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/zones/{zone_id}/dns_records/{record_id}");
    let resp = creds.apply(client.delete(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("dns delete: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("dns delete HTTP {status}: {body}") });
    }
    Ok(())
}
