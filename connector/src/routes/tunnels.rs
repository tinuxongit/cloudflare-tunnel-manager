use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use cf_tunnel_core::cloudflared::api;
use cf_tunnel_core::db::models::Tunnel;
use cf_tunnel_core::db::queries;
use cf_tunnel_core::metrics::{self, RuntimeStatus};
use cf_tunnel_core::supervisor::log_buffer::LogLine;

use crate::error::ApiError;
use crate::events::StateEvent;
use crate::state::ConnectorState;

pub async fn list_tunnels(
    State(state): State<ConnectorState>,
) -> Result<Json<Vec<Tunnel>>, ApiError> {
    // API path — works with just the synced CF token, no cert.pem needed on
    // the server. The CLI listing requires `cloudflared tunnel login`, which
    // we can't run on a headless connector.
    let creds = api::resolve_credentials()?;
    let mut fresh = api::list_tunnels(&creds).await?;
    {
        let g = state.core.db.lock();
        for t in &fresh {
            queries::upsert_tunnel(&g, t)?;
        }
    }
    let g = state.core.db.lock();
    let cached = queries::list_tunnels(&g)?;
    for t in &mut fresh {
        if let Some(c) = cached.iter().find(|c| c.uuid == t.uuid) {
            t.managed = c.managed;
        }
    }
    Ok(Json(fresh))
}

#[derive(Deserialize)]
pub struct CreateTunnelBody {
    pub name: String,
}

pub async fn create_tunnel(
    State(state): State<ConnectorState>,
    Json(body): Json<CreateTunnelBody>,
) -> Result<Json<Tunnel>, ApiError> {
    let creds = api::resolve_credentials()?;
    let mut t = api::create_tunnel(&creds, &body.name).await?;
    t.managed = true;
    {
        let g = state.core.db.lock();
        queries::upsert_tunnel(&g, &t)?;
    }
    state.events.publish(StateEvent::TunnelsChanged);
    Ok(Json(t))
}

pub async fn delete_tunnel(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
) -> Result<Json<()>, ApiError> {
    let creds = api::resolve_credentials()?;
    // Stop the supervised child FIRST. Cloudflare's delete API rejects a
    // tunnel with active connections, and even when it doesn't, leaving a
    // local cloudflared process running after the row is gone makes the
    // process unrecoverable (no DB entry to find it again).
    state.core.supervisor.stop(&uuid);
    api::delete_tunnel(&creds, &uuid).await?;
    {
        let g = state.core.db.lock();
        queries::delete_tunnel(&g, &uuid)?;
    }
    state.events.publish(StateEvent::TunnelStatus {
        uuid: uuid.clone(),
        state: "stopped".into(),
    });
    state.events.publish(StateEvent::TunnelsChanged);
    Ok(Json(()))
}

pub async fn stop_tunnel(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
) -> Result<Json<()>, ApiError> {
    state.core.supervisor.stop(&uuid);
    state.events.publish(StateEvent::TunnelStatus {
        uuid: uuid.clone(),
        state: "stopped".into(),
    });
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct RouteDnsViaApiBody {
    pub zone_id: String,
    pub hostname: String,
    pub tunnel_uuid: String,
    pub overwrite: Option<bool>,
}

pub async fn route_dns_via_api(
    Json(body): Json<RouteDnsViaApiBody>,
) -> Result<Json<()>, ApiError> {
    let creds = api::resolve_credentials()?;
    api::upsert_tunnel_cname(
        &creds,
        &body.zone_id,
        &body.hostname,
        &body.tunnel_uuid,
        body.overwrite.unwrap_or(false),
    )
    .await?;
    Ok(Json(()))
}

pub async fn get_status(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
) -> Result<Json<RuntimeStatus>, ApiError> {
    let port = state.core.supervisor.metrics_port(&uuid);
    let status = match port {
        None => RuntimeStatus {
            state: "stopped",
            ..Default::default()
        },
        Some(p) => {
            if !state.core.supervisor.is_running(&uuid) {
                RuntimeStatus {
                    state: "error",
                    ..Default::default()
                }
            } else {
                match metrics::scraper::fetch(p).await {
                    Ok(s) => s,
                    Err(_) => RuntimeStatus {
                        state: "starting",
                        ..Default::default()
                    },
                }
            }
        }
    };
    Ok(Json(status))
}

#[derive(Deserialize)]
pub struct LastNQuery {
    #[serde(rename = "lastN", default = "default_last_n")]
    pub last_n: usize,
}

fn default_last_n() -> usize {
    100
}

pub async fn get_logs(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
    Query(q): Query<LastNQuery>,
) -> Result<Json<Vec<LogLine>>, ApiError> {
    Ok(Json(state.core.supervisor.logs(&uuid, q.last_n)))
}

pub async fn list_zones() -> Result<Json<Vec<api::Zone>>, ApiError> {
    let creds = api::resolve_credentials()?;
    Ok(Json(api::list_zones(&creds).await?))
}
