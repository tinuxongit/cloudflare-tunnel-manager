use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use cf_tunnel_core::cloudflared::api;
use cf_tunnel_core::db::models::{NewPageInput, Page, PagePatch};
use cf_tunnel_core::db::queries;
use cf_tunnel_core::local_server::EMBEDDED_STATIC;

use crate::error::ApiError;
use crate::events::StateEvent;
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
    let p = {
        let g = state.core.db.lock();
        queries::insert_page(&g, &input)?
    };
    state.events.publish(StateEvent::PagesChanged);
    Ok(Json(p))
}

pub async fn update_page(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
    Json(patch): Json<PagePatch>,
) -> Result<Json<Page>, ApiError> {
    let p = {
        let g = state.core.db.lock();
        queries::update_page(&g, id, &patch)?
    };
    state.events.publish(StateEvent::PagesChanged);
    Ok(Json(p))
}

pub async fn delete_page(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
) -> Result<Json<()>, ApiError> {
    {
        let g = state.core.db.lock();
        queries::delete_page(&g, id)?;
    }
    state.events.publish(StateEvent::PagesChanged);
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
    let p = {
        let g = state.core.db.lock();
        queries::update_page(&g, id, &patch)?
    };
    state.events.publish(StateEvent::PagesChanged);
    Ok(Json(p))
}

pub async fn start_or_restart(
    State(state): State<ConnectorState>,
    Path(page_id): Path<i64>,
) -> Result<Json<()>, ApiError> {
    let (tunnel_uuid, this_page) = {
        let g = state.core.db.lock();
        let page = queries::get_page(&g, page_id)?;
        (page.tunnel_uuid.clone(), page)
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
                    assigned_port: Some(Some(port)),
                    ..Default::default()
                },
            )?;
        }
    } else {
        state.core.local.stop(page_id);
    }

    let enabled_siblings: Vec<Page> = {
        let g = state.core.db.lock();
        let fresh = queries::list_pages(&g)?;
        fresh
            .into_iter()
            .filter(|p| p.tunnel_uuid == tunnel_uuid && p.enabled)
            .collect()
    };

    if enabled_siblings.is_empty() {
        state.core.supervisor.stop(&tunnel_uuid);
        state.events.publish(StateEvent::PagesChanged);
        state.events.publish(StateEvent::TunnelStatus {
            uuid: tunnel_uuid.clone(),
            state: "stopped".into(),
        });
        return Ok(Json(()));
    }

    let ingress: Vec<api::IngressRule> = enabled_siblings
        .iter()
        .map(|p| api::IngressRule {
            hostname: Some(p.hostname.clone()),
            service: p.service_url.clone(),
            path: None,
        })
        .chain(std::iter::once(api::IngressRule {
            hostname: None,
            service: "http_status:404".into(),
            path: None,
        }))
        .collect();

    let creds = api::resolve_credentials()?;
    api::put_tunnel_config(&creds, &tunnel_uuid, ingress).await?;
    let token = api::get_tunnel_token(&creds, &tunnel_uuid).await?;
    state.core.supervisor.restart_with_token(&tunnel_uuid, &token)?;

    state.events.publish(StateEvent::PagesChanged);
    state.events.publish(StateEvent::TunnelStatus {
        uuid: tunnel_uuid.clone(),
        state: "starting".into(),
    });
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
