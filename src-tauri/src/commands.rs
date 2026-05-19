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
