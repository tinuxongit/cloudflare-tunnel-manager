use tauri::State;
use crate::state::AppState;
use crate::db::models::*;
use crate::db::queries;
use crate::error::AppResult;

#[tauri::command]
pub fn list_pages(state: State<AppState>) -> AppResult<Vec<Page>> {
    let g = state.db.lock();
    queries::list_pages(&g)
}

#[tauri::command]
pub fn create_page(state: State<AppState>, input: NewPageInput) -> AppResult<Page> {
    let g = state.db.lock();
    queries::insert_page(&g, &input)
}

#[tauri::command]
pub fn update_page(state: State<AppState>, id: i64, patch: PagePatch) -> AppResult<Page> {
    let g = state.db.lock();
    queries::update_page(&g, id, &patch)
}

#[tauri::command]
pub fn delete_page(state: State<AppState>, id: i64) -> AppResult<()> {
    let g = state.db.lock();
    queries::delete_page(&g, id)
}

#[tauri::command]
pub fn toggle_page(state: State<AppState>, id: i64, on: bool) -> AppResult<Page> {
    let g = state.db.lock();
    let patch = PagePatch { enabled: Some(on), ..Default::default() };
    queries::update_page(&g, id, &patch)
    // NOTE: actual proc restart is wired in Task 19 (orchestrator)
}

use crate::cloudflared::cli::CloudflaredCli;

#[tauri::command]
pub fn list_tunnels(state: State<AppState>) -> AppResult<Vec<Tunnel>> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path.clone());
    let mut fresh = cli.list_tunnels()?;
    {
        let g = state.db.lock();
        for t in &fresh { queries::upsert_tunnel(&g, t)?; }
    }
    // merge managed flag from DB cache
    let g = state.db.lock();
    let cached = queries::list_tunnels(&g)?;
    for t in &mut fresh {
        if let Some(c) = cached.iter().find(|c| c.uuid == t.uuid) {
            t.managed = c.managed;
        }
    }
    Ok(fresh)
}

#[tauri::command]
pub fn create_tunnel(state: State<AppState>, name: String) -> AppResult<Tunnel> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path.clone());
    let mut t = cli.create_tunnel(&name)?;
    t.managed = true;
    let g = state.db.lock();
    queries::upsert_tunnel(&g, &t)?;
    Ok(t)
}

#[tauri::command]
pub fn delete_tunnel(state: State<AppState>, uuid: String) -> AppResult<()> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path.clone());
    cli.delete_tunnel(&uuid)?;
    let g = state.db.lock();
    queries::delete_tunnel(&g, &uuid)
}

#[tauri::command]
pub fn route_dns(state: State<AppState>, uuid: String, hostname: String, overwrite: Option<bool>) -> AppResult<()> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path.clone());
    cli.route_dns(&uuid, &hostname, overwrite.unwrap_or(false))
}

/// Create or replace the tunnel CNAME on a specific zone via the Cloudflare REST API.
/// Bypasses cloudflared's flaky zone-guessing — the caller picks the exact zone.
/// Requires the saved API token to have Zone:DNS:Edit permission.
#[tauri::command]
pub async fn route_dns_via_api(
    zone_id: String,
    hostname: String,
    tunnel_uuid: String,
    overwrite: Option<bool>,
) -> AppResult<()> {
    let creds = crate::cloudflared::api::resolve_credentials()?;
    crate::cloudflared::api::upsert_tunnel_cname(
        &creds, &zone_id, &hostname, &tunnel_uuid, overwrite.unwrap_or(false),
    ).await
}

use crate::metrics::{self, RuntimeStatus};
use crate::supervisor::log_buffer::LogLine;
use crate::health::{check::check as service_check, ServiceHealth};
use crate::cloudflared::cert;
use serde::Serialize;

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>, tunnel_uuid: String) -> AppResult<RuntimeStatus> {
    let port = state.supervisor.metrics_port(&tunnel_uuid);
    match port {
        None => Ok(RuntimeStatus { state: "stopped", ..Default::default() }),
        Some(p) => {
            // If the proc died (bad config, crash), supervisor.is_running returns false.
            // Report "error" so the UI stops showing "starting" forever.
            if !state.supervisor.is_running(&tunnel_uuid) {
                return Ok(RuntimeStatus { state: "error", ..Default::default() });
            }
            // Proc alive — try the metrics endpoint. If it's not up yet (proc starting),
            // surface "starting" instead of returning an error.
            match metrics::scraper::fetch(p).await {
                Ok(s) => Ok(s),
                Err(_) => Ok(RuntimeStatus { state: "starting", ..Default::default() }),
            }
        }
    }
}

#[tauri::command]
pub fn get_logs(state: State<AppState>, tunnel_uuid: String, last_n: usize) -> AppResult<Vec<LogLine>> {
    Ok(state.supervisor.logs(&tunnel_uuid, last_n))
}

#[tauri::command]
pub fn stop_tunnel(state: State<AppState>, uuid: String) -> AppResult<()> {
    state.supervisor.stop(&uuid);
    Ok(())
}

#[tauri::command]
pub async fn check_local_service(url: String) -> AppResult<ServiceHealth> {
    Ok(service_check(&url).await)
}

#[derive(Serialize)]
pub struct CloudflaredInfo {
    pub path: String,
    pub version: String,
    pub logged_in: bool,
    pub cert_path: String,
}

#[tauri::command]
pub fn cloudflared_info(state: State<AppState>) -> AppResult<CloudflaredInfo> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path.clone());
    let version = cli.version().unwrap_or_else(|_| "unknown".into());
    Ok(CloudflaredInfo {
        path: state.supervisor.cloudflared_path.display().to_string(),
        version,
        logged_in: cert::is_logged_in(),
        cert_path: cert::cert_path().display().to_string(),
    })
}

use crate::local_server;

#[tauri::command]
pub fn detect_folder(path: String) -> AppResult<local_server::detect::Detected> {
    Ok(local_server::detect(std::path::Path::new(&path)))
}

#[tauri::command]
pub fn write_setup_guide(path: String) -> AppResult<String> {
    let p = local_server::setup_guide::write_setup_guide(std::path::Path::new(&path))?;
    Ok(p.display().to_string())
}

#[tauri::command]
pub fn get_local_logs(state: State<AppState>, page_id: i64, last_n: usize)
    -> AppResult<Vec<crate::supervisor::log_buffer::LogLine>>
{
    Ok(state.local.logs(page_id, last_n))
}

#[tauri::command]
pub fn local_is_running(state: State<AppState>, page_id: i64) -> AppResult<bool> {
    Ok(state.local.is_running(page_id))
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<Settings> {
    let g = state.db.lock();
    queries::get_settings(&g)
}

#[tauri::command]
pub fn set_settings(state: State<AppState>, patch: SettingsPatch) -> AppResult<Settings> {
    let g = state.db.lock();
    queries::set_settings(&g, &patch)
}

use crate::cloudflared::config_gen;

#[tauri::command]
pub async fn start_or_restart_for_page(state: State<'_, AppState>, page_id: i64) -> AppResult<()> {
    // 1. Load this page. If it has a folder + run_command and is enabled,
    //    spawn (or restart) the local server. Sync the assigned port back
    //    into the page's service_url so cloudflared forwards there.
    let (tunnel_uuid, this_page, all_pages, cred_path) = {
        let g = state.db.lock();
        let page = queries::get_page(&g, page_id)?;
        let all = queries::list_pages(&g)?;
        let tunnels = queries::list_tunnels(&g)?;
        let cred = tunnels.iter()
            .find(|t| t.uuid == page.tunnel_uuid)
            .map(|t| t.cred_path.clone())
            .unwrap_or_default();
        (page.tunnel_uuid.clone(), page, all, cred)
    };

    if this_page.enabled {
        if let (Some(dir), Some(cmd)) = (this_page.source_dir.as_ref(), this_page.run_command.as_ref()) {
            let port = match this_page.assigned_port {
                Some(p) => p,
                None    => state.local.alloc_port()?,
            };
            state.local.stop(page_id);
            let dir_path = std::path::Path::new(dir);
            let port = if cmd == crate::local_server::EMBEDDED_STATIC {
                state.local.start_static(page_id, dir_path, port).await?
            } else {
                state.local.start_external(page_id, dir_path, cmd, port)?
            };
            let url = format!("http://localhost:{port}");
            let g = state.db.lock();
            queries::update_page(&g, page_id, &PagePatch {
                service_url: Some(url),
                assigned_port: Some(port),
                ..Default::default()
            })?;
        }
    } else {
        state.local.stop(page_id);
    }

    // 2. Rebuild ingress YAML for this tunnel using the freshest page rows.
    let (enabled_siblings, _) = {
        let g = state.db.lock();
        let fresh = queries::list_pages(&g)?;
        let siblings: Vec<Page> = fresh.into_iter()
            .filter(|p| p.tunnel_uuid == tunnel_uuid && p.enabled)
            .collect();
        (siblings, all_pages) // all_pages is just kept for symmetry; unused
    };

    let yaml = config_gen::build_yaml(&tunnel_uuid, &cred_path, &enabled_siblings);
    let cfg_path = config_gen::write_yaml(&state.configs_dir, &tunnel_uuid, &yaml)?;

    // 3. Restart cloudflared proc (or stop it if no pages remain).
    if enabled_siblings.is_empty() {
        state.supervisor.stop(&tunnel_uuid);
    } else {
        state.supervisor.restart(&tunnel_uuid, &cfg_path)?;
    }
    Ok(())
}

// --- Cloudflare API token + zones -------------------------------------------

use crate::secrets;
use crate::cloudflared::api;

#[tauri::command]
pub async fn set_api_token(token: String) -> AppResult<()> {
    // 1. Verify the raw token against Cloudflare before touching keyring.
    api::verify_token(&token).await?;

    // 2. Persist to OS keyring.
    secrets::set(secrets::CF_API_TOKEN, &token)
        .map_err(|e| crate::error::AppError::Other { message: format!("keyring write: {e}") })?;

    // 3. Read back to confirm the credential survived the write. Catches the
    //    case where the OS credential store silently rejects the write or
    //    returns success without persisting (seen on locked-down Windows
    //    profiles, sandboxed shells, missing credentials service on Linux).
    match secrets::get(secrets::CF_API_TOKEN) {
        Some(stored) if stored == token => Ok(()),
        Some(_) => Err(crate::error::AppError::Other {
            message: "keyring read-back returned a different value than was written".into(),
        }),
        None => Err(crate::error::AppError::Other {
            message: "keyring write succeeded but read-back returned nothing — credential did not persist. Check Windows Credential Manager access.".into(),
        }),
    }
}

#[tauri::command]
pub fn clear_api_token() -> AppResult<()> {
    let _ = secrets::delete(secrets::CF_API_TOKEN);
    Ok(())
}

#[tauri::command]
pub fn has_api_token() -> AppResult<bool> {
    Ok(secrets::has(secrets::CF_API_TOKEN))
}

/// Returns the raw token if one is saved. Used by the UI's "reveal" button.
/// The token never leaves the local machine — same process, no network — so this
/// is no more sensitive than the keyring read happening anyway.
#[tauri::command]
pub fn get_api_token() -> AppResult<Option<String>> {
    Ok(secrets::get(secrets::CF_API_TOKEN))
}

#[tauri::command]
pub async fn verify_api_token() -> AppResult<()> {
    let Some(token) = secrets::get(secrets::CF_API_TOKEN) else {
        return Err(crate::error::AppError::Other { message: "no token saved".into() });
    };
    api::verify_token(&token).await
}

#[tauri::command]
pub async fn list_zones() -> AppResult<Vec<api::Zone>> {
    let creds = api::resolve_credentials()?;
    api::list_zones(&creds).await
}

// --- Global API Key (legacy auth) ------------------------------------------

#[tauri::command]
pub async fn set_global_key(email: String, key: String) -> AppResult<()> {
    let creds = api::Credentials::GlobalKey { email: email.clone(), key: key.clone() };
    api::verify(&creds).await?;
    secrets::set(secrets::CF_GLOBAL_EMAIL, &email)
        .map_err(|e| crate::error::AppError::Other { message: format!("keyring write (email): {e}") })?;
    secrets::set(secrets::CF_GLOBAL_KEY, &key)
        .map_err(|e| crate::error::AppError::Other { message: format!("keyring write (key): {e}") })?;
    // Read-back sanity check
    match (secrets::get(secrets::CF_GLOBAL_EMAIL), secrets::get(secrets::CF_GLOBAL_KEY)) {
        (Some(e), Some(k)) if e == email && k == key => Ok(()),
        _ => Err(crate::error::AppError::Other {
            message: "keyring read-back failed for global key — credential did not persist.".into(),
        }),
    }
}

#[tauri::command]
pub fn clear_global_key() -> AppResult<()> {
    let _ = secrets::delete(secrets::CF_GLOBAL_EMAIL);
    let _ = secrets::delete(secrets::CF_GLOBAL_KEY);
    Ok(())
}

#[tauri::command]
pub fn has_global_key() -> AppResult<bool> {
    Ok(secrets::has(secrets::CF_GLOBAL_EMAIL) && secrets::has(secrets::CF_GLOBAL_KEY))
}

#[tauri::command]
pub fn get_global_key() -> AppResult<Option<(String, String)>> {
    match (secrets::get(secrets::CF_GLOBAL_EMAIL), secrets::get(secrets::CF_GLOBAL_KEY)) {
        (Some(e), Some(k)) => Ok(Some((e, k))),
        _ => Ok(None),
    }
}
