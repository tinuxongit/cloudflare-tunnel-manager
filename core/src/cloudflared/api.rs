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

pub fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Other { message: format!("http client: {e}") })
}

pub const CF_API_BASE: &str = API_BASE;

/// Generic CF envelope. Use when the response shape is `{result, success, errors}`.
#[derive(Deserialize)]
pub struct CfEnvelope<T> {
    pub result: Option<T>,
    pub success: bool,
    pub errors: Option<Vec<CfApiError>>,
}

#[derive(Deserialize)]
pub struct CfApiError {
    pub code: u32,
    pub message: String,
}

impl<T> CfEnvelope<T> {
    pub fn into_result(self, what: &str) -> AppResult<T> {
        if self.success {
            self.result.ok_or_else(|| AppError::Other {
                message: format!("{what}: success=true but no result body"),
            })
        } else {
            let msg = self.errors
                .and_then(|es| es.first().map(|e| format!("{}: {}", e.code, e.message)))
                .unwrap_or_else(|| format!("{what}: unknown CF API error"));
            Err(AppError::Other { message: msg })
        }
    }
}

/// Resolve the active account id. CF's API requires this for most non-zone
/// resources. Picks the first account the credential can see.
pub async fn account_id(creds: &Credentials) -> AppResult<String> {
    #[derive(Deserialize)]
    struct AcctSlim { id: String }

    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts?per_page=5");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("accounts request: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("accounts: HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Vec<AcctSlim>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("accounts parse: {e} — body: {body}") })?;
    let accts = env.into_result("accounts")?;
    let first = accts.into_iter().next().ok_or(AppError::Other {
        message: "No Cloudflare accounts visible to this token. Grant the token at least one account scope.".into(),
    })?;
    Ok(first.id)
}

// ── Zone cache controls ───────────────────────────────────────────────────

/// Purge Cloudflare's edge cache for a zone. Use after pushing website file
/// changes so visitors see the new content immediately instead of the old
/// edge-cached copy.
///
/// If `files` is empty, purges everything in the zone. Otherwise purges only
/// the listed URLs. CF caps the list at 30 per call on free plans.
pub async fn purge_cache(
    creds: &Credentials,
    zone_id: &str,
    files: &[String],
) -> AppResult<()> {
    let client = http_client()?;
    let url = format!("{API_BASE}/zones/{zone_id}/purge_cache");
    let body = if files.is_empty() {
        serde_json::json!({ "purge_everything": true })
    } else {
        serde_json::json!({ "files": files })
    };
    let resp = creds.apply(client.post(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("purge_cache: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("purge_cache HTTP {status}: {txt}") });
    }
    Ok(())
}

/// Toggle CF Development Mode for a zone. Bypasses the edge cache for 3 hours
/// (CF auto-disables it after that). Ideal while iterating on a website
/// without having to manually purge every change.
pub async fn set_development_mode(
    creds: &Credentials,
    zone_id: &str,
    on: bool,
) -> AppResult<()> {
    let client = http_client()?;
    let url = format!("{API_BASE}/zones/{zone_id}/settings/development_mode");
    let body = serde_json::json!({ "value": if on { "on" } else { "off" } });
    let resp = creds.apply(client.patch(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("dev_mode: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("dev_mode HTTP {status}: {txt}") });
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevModeStatus {
    pub on: bool,
    /// Unix timestamp when CF will auto-disable dev mode. Null when off.
    pub expires_at: Option<i64>,
}

pub async fn get_development_mode(
    creds: &Credentials,
    zone_id: &str,
) -> AppResult<DevModeStatus> {
    #[derive(Deserialize)]
    struct Setting {
        value: String,
        #[serde(default)]
        time_remaining: Option<i64>,
    }
    let client = http_client()?;
    let url = format!("{API_BASE}/zones/{zone_id}/settings/development_mode");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("get_dev_mode: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("get_dev_mode HTTP {status}: {body}") });
    }
    let env: CfEnvelope<Setting> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("get_dev_mode parse: {e} — body: {body}") })?;
    let s = env.into_result("dev_mode")?;
    let on = s.value == "on";
    let expires_at = if on {
        s.time_remaining.map(|secs| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64 + secs)
                .unwrap_or(0)
        })
    } else {
        None
    };
    Ok(DevModeStatus { on, expires_at })
}

// ── Tunnels (Cloudflare Tunnel API) ──────────────────────────────────────

/// Tunnel record returned by the CF Tunnel API. We map this onto the
/// `db::models::Tunnel` shape downstream so the rest of the app doesn't
/// have to know whether the data came from CLI or API.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiTunnel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

/// Create a new tunnel under `config_src: "cloudflare"` so its ingress
/// rules can be managed via API (no local YAML needed) and it can be run
/// with `cloudflared tunnel run --token=<base64>` — no cert.pem on the
/// connector machine required.
pub async fn create_tunnel(
    creds: &Credentials,
    name: &str,
) -> AppResult<crate::db::models::Tunnel> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{API_BASE}/accounts/{acct}/cfd_tunnel");
    let body = serde_json::json!({
        "name": name,
        "config_src": "cloudflare",
    });
    let resp = creds.apply(client.post(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("tunnel create: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tunnel_scope_error(status, &txt));
    }
    let env: CfEnvelope<ApiTunnel> = serde_json::from_str(&txt)
        .map_err(|e| AppError::Other { message: format!("tunnel create parse: {e} — body: {txt}") })?;
    let t = env.into_result("tunnel create")?;
    Ok(crate::db::models::Tunnel {
        uuid: t.id,
        name: t.name,
        cred_path: String::new(),
        managed: true,
        last_seen: t.created_at.unwrap_or_default(),
    })
}

/// Delete a tunnel via the API. CF allows force-deleting an active tunnel
/// (it gets soft-deleted and stops accepting traffic).
pub async fn delete_tunnel(creds: &Credentials, uuid: &str) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{API_BASE}/accounts/{acct}/cfd_tunnel/{uuid}");
    let resp = creds.apply(client.delete(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("tunnel delete: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tunnel_scope_error(status, &txt));
    }
    Ok(())
}

/// Fetch the base64-encoded run token for a tunnel. Pass this to
/// `cloudflared tunnel run --token=<token>`.
pub async fn get_tunnel_token(creds: &Credentials, uuid: &str) -> AppResult<String> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{API_BASE}/accounts/{acct}/cfd_tunnel/{uuid}/token");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("tunnel token: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tunnel_scope_error(status, &body));
    }
    let env: CfEnvelope<String> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("tunnel token parse: {e} — body: {body}") })?;
    env.into_result("tunnel token")
}

/// One ingress rule. Mirrors the YAML shape we used to write to disk; this
/// is what the connector now PUTs to /cfd_tunnel/{id}/configurations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngressRule {
    pub hostname: Option<String>,
    pub service: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

pub async fn put_tunnel_config(
    creds: &Credentials,
    uuid: &str,
    ingress: Vec<IngressRule>,
) -> AppResult<()> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{API_BASE}/accounts/{acct}/cfd_tunnel/{uuid}/configurations");
    let body = serde_json::json!({
        "config": { "ingress": ingress },
    });
    let resp = creds.apply(client.put(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("tunnel config put: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tunnel_scope_error(status, &txt));
    }
    Ok(())
}

/// List the user's Cloudflare Tunnels via the REST API. Works with just the
/// saved API token — no `cloudflared tunnel login` / cert.pem required, so
/// it's safe to call from the connector (which has the token synced over)
/// or from local mode.
pub async fn list_tunnels(creds: &Credentials) -> AppResult<Vec<crate::db::models::Tunnel>> {
    let acct = account_id(creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/cfd_tunnel?is_deleted=false&per_page=1000");
    let resp = creds.apply(client.get(&url)).send().await
        .map_err(|e| AppError::Other { message: format!("tunnels list: {e}") })?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tunnel_scope_error(status, &body));
    }
    let env: CfEnvelope<Vec<ApiTunnel>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Other { message: format!("tunnels parse: {e} — body: {body}") })?;
    let raw = env.into_result("tunnels list")?;
    Ok(raw
        .into_iter()
        // The is_deleted=false query param filters server-side, but CF still
        // sometimes returns soft-deleted rows on accounts with a long history.
        .filter(|t| t.deleted_at.is_none())
        .map(|t| crate::db::models::Tunnel {
            uuid: t.id,
            name: t.name,
            // No local credentials file in API mode — running an API-listed
            // tunnel needs the cloudflared `--token` flag instead. Empty
            // marker, callers detect and use the API token path.
            cred_path: String::new(),
            managed: false,
            last_seen: t.created_at.unwrap_or_default(),
        })
        .collect())
}

fn tunnel_scope_error(status: reqwest::StatusCode, body: &str) -> AppError {
    let is_auth = status.as_u16() == 401
        || status.as_u16() == 403
        || body.contains("\"code\":10000");
    if is_auth {
        AppError::Other {
            message: format!(
                "Listing tunnels failed: your Cloudflare API token is missing the \
                'Account / Cloudflare Tunnel / Read' permission.\n\n\
                Fix: edit the token at https://dash.cloudflare.com/profile/api-tokens, \
                add that row, then click Settings → Cloudflare → Replace with the new value.\n\n\
                Raw response: HTTP {status}: {body}"
            ),
        }
    } else {
        AppError::Other {
            message: format!("tunnels list HTTP {status}: {body}"),
        }
    }
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
