use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use cf_tunnel_core::cloudflared::{api, cli::CloudflaredCli};
use cf_tunnel_core::db::models::Tunnel;
use cf_tunnel_core::db::queries;
use cf_tunnel_core::metrics::{self, RuntimeStatus};
use cf_tunnel_core::supervisor::log_buffer::LogLine;

use crate::error::ApiError;
use crate::state::ConnectorState;

pub async fn list_tunnels(
    State(state): State<ConnectorState>,
) -> Result<Json<Vec<Tunnel>>, ApiError> {
    let cli = CloudflaredCli::with_path(state.core.supervisor.cloudflared_path.clone());
    let mut fresh = cli.list_tunnels()?;
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
    let cli = CloudflaredCli::with_path(state.core.supervisor.cloudflared_path.clone());
    let mut t = cli.create_tunnel(&body.name)?;
    t.managed = true;
    let g = state.core.db.lock();
    queries::upsert_tunnel(&g, &t)?;
    Ok(Json(t))
}

pub async fn delete_tunnel(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
) -> Result<Json<()>, ApiError> {
    let cli = CloudflaredCli::with_path(state.core.supervisor.cloudflared_path.clone());
    cli.delete_tunnel(&uuid)?;
    let g = state.core.db.lock();
    queries::delete_tunnel(&g, &uuid)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct RouteDnsBody {
    pub hostname: String,
    pub overwrite: Option<bool>,
}

pub async fn route_dns(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
    Json(body): Json<RouteDnsBody>,
) -> Result<Json<()>, ApiError> {
    let cli = CloudflaredCli::with_path(state.core.supervisor.cloudflared_path.clone());
    cli.route_dns(&uuid, &body.hostname, body.overwrite.unwrap_or(false))?;
    Ok(Json(()))
}

pub async fn stop_tunnel(
    State(state): State<ConnectorState>,
    Path(uuid): Path<String>,
) -> Result<Json<()>, ApiError> {
    state.core.supervisor.stop(&uuid);
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
