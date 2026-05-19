use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use cf_tunnel_core::cloudflared::config_gen;
use cf_tunnel_core::db::models::{NewPageInput, Page, PagePatch};
use cf_tunnel_core::db::queries;
use cf_tunnel_core::local_server::EMBEDDED_STATIC;

use crate::error::ApiError;
use crate::state::ConnectorState;

pub async fn list_pages(
    State(state): State<ConnectorState>,
) -> Result<Json<Vec<Page>>, ApiError> {
    let g = state.core.db.lock();
    Ok(Json(queries::list_pages(&g)?))
}

pub async fn create_page(
    State(state): State<ConnectorState>,
    Json(input): Json<NewPageInput>,
) -> Result<Json<Page>, ApiError> {
    let g = state.core.db.lock();
    Ok(Json(queries::insert_page(&g, &input)?))
}

pub async fn update_page(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
    Json(patch): Json<PagePatch>,
) -> Result<Json<Page>, ApiError> {
    let g = state.core.db.lock();
    Ok(Json(queries::update_page(&g, id, &patch)?))
}

pub async fn delete_page(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
) -> Result<Json<()>, ApiError> {
    let g = state.core.db.lock();
    queries::delete_page(&g, id)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct ToggleBody {
    pub on: bool,
}

pub async fn toggle_page(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
    Json(body): Json<ToggleBody>,
) -> Result<Json<Page>, ApiError> {
    let patch = PagePatch {
        enabled: Some(body.on),
        ..Default::default()
    };
    let g = state.core.db.lock();
    Ok(Json(queries::update_page(&g, id, &patch)?))
}

pub async fn start_or_restart(
    State(state): State<ConnectorState>,
    Path(page_id): Path<i64>,
) -> Result<Json<()>, ApiError> {
    let (tunnel_uuid, this_page, cred_path) = {
        let g = state.core.db.lock();
        let page = queries::get_page(&g, page_id)?;
        let tunnels = queries::list_tunnels(&g)?;
        let cred = tunnels
            .iter()
            .find(|t| t.uuid == page.tunnel_uuid)
            .map(|t| t.cred_path.clone())
            .unwrap_or_default();
        (page.tunnel_uuid.clone(), page, cred)
    };

    if this_page.enabled {
        if let (Some(dir), Some(cmd)) = (
            this_page.source_dir.as_ref(),
            this_page.run_command.as_ref(),
        ) {
            let port = match this_page.assigned_port {
                Some(p) => p,
                None => state.core.local.alloc_port()?,
            };
            state.core.local.stop(page_id);
            let dir_path = std::path::Path::new(dir);
            let port = if cmd == EMBEDDED_STATIC {
                state.core.local.start_static(page_id, dir_path, port).await?
            } else {
                state.core.local.start_external(page_id, dir_path, cmd, port)?
            };
            let url = format!("http://localhost:{port}");
            let g = state.core.db.lock();
            queries::update_page(
                &g,
                page_id,
                &PagePatch {
                    service_url: Some(url),
                    assigned_port: Some(port),
                    ..Default::default()
                },
            )?;
        }
    } else {
        state.core.local.stop(page_id);
    }

    let (enabled_siblings, cfg_path) = {
        let g = state.core.db.lock();
        let fresh = queries::list_pages(&g)?;
        let siblings: Vec<Page> = fresh
            .into_iter()
            .filter(|p| p.tunnel_uuid == tunnel_uuid && p.enabled)
            .collect();
        let yaml = config_gen::build_yaml(&tunnel_uuid, &cred_path, &siblings);
        let cfg = config_gen::write_yaml(&state.core.configs_dir, &tunnel_uuid, &yaml)?;
        (siblings, cfg)
    };

    if enabled_siblings.is_empty() {
        state.core.supervisor.stop(&tunnel_uuid);
    } else {
        state.core.supervisor.restart(&tunnel_uuid, &cfg_path)?;
    }

    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct LastNQuery {
    #[serde(rename = "lastN", default = "default_last_n")]
    pub last_n: usize,
}

fn default_last_n() -> usize {
    100
}

pub async fn local_logs(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
    Query(q): Query<LastNQuery>,
) -> Result<Json<Vec<cf_tunnel_core::supervisor::log_buffer::LogLine>>, ApiError> {
    Ok(Json(state.core.local.logs(id, q.last_n)))
}

pub async fn local_running(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
) -> Result<Json<bool>, ApiError> {
    Ok(Json(state.core.local.is_running(id)))
}
