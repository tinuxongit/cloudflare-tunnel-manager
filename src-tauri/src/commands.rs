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
pub fn route_dns(state: State<AppState>, uuid: String, hostname: String) -> AppResult<()> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path.clone());
    cli.route_dns(&uuid, &hostname)
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
        None    => Ok(RuntimeStatus { state: "stopped", ..Default::default() }),
        Some(p) => metrics::scraper::fetch(p).await,
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
    // 1. load page + sibling pages on same tunnel
    let (tunnel_uuid, enabled_siblings, cred_path) = {
        let g = state.db.lock();
        let page = queries::get_page(&g, page_id)?;
        let all = queries::list_pages(&g)?;
        let siblings: Vec<Page> = all.into_iter()
            .filter(|p| p.tunnel_uuid == page.tunnel_uuid && p.enabled)
            .collect();
        let tunnels = queries::list_tunnels(&g)?;
        let cred = tunnels.iter()
            .find(|t| t.uuid == page.tunnel_uuid)
            .map(|t| t.cred_path.clone())
            .unwrap_or_default();
        (page.tunnel_uuid, siblings, cred)
    };

    // 2. generate yaml
    let yaml = config_gen::build_yaml(&tunnel_uuid, &cred_path, &enabled_siblings);
    let cfg_path = config_gen::write_yaml(&state.configs_dir, &tunnel_uuid, &yaml)?;

    // 3. restart proc
    if enabled_siblings.is_empty() {
        state.supervisor.stop(&tunnel_uuid);
    } else {
        state.supervisor.restart(&tunnel_uuid, &cfg_path)?;
    }
    Ok(())
}
