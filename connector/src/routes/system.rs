use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::auth::new_token;
use crate::state::ConnectorState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub version: &'static str,
    pub paired: bool,
}

pub async fn health(State(state): State<ConnectorState>) -> Json<HealthResponse> {
    let paired = state.config.lock().paired_token.is_some();
    Json(HealthResponse {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
        paired,
    })
}

#[derive(Deserialize)]
pub struct PairRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct PairResponse {
    pub token: String,
}

pub async fn pair(
    State(state): State<ConnectorState>,
    Json(body): Json<PairRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if !state.pairing.consume(&body.code) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Already paired? Reject re-pairing via this endpoint.
    {
        let cfg = state.config.lock();
        if cfg.paired_token.is_some() {
            return Err(StatusCode::CONFLICT);
        }
    }

    let token = new_token();
    {
        let mut cfg = state.config.lock();
        cfg.paired_token = Some(token.clone());
        if let Err(e) = cfg.save() {
            tracing::error!("failed to save config after pairing: {e}");
        }
    }

    Ok(Json(PairResponse { token }))
}

#[derive(Serialize)]
pub struct CloudflaredInfo {
    pub path: String,
    pub version: String,
    pub logged_in: bool,
    pub cert_path: String,
}

pub async fn cloudflared_info(
    State(state): State<ConnectorState>,
) -> Result<Json<CloudflaredInfo>, (StatusCode, String)> {
    use cf_tunnel_core::cloudflared::{cert, cli::CloudflaredCli};

    let cli = CloudflaredCli::with_path(state.core.supervisor.cloudflared_path.clone());
    let version = cli.version().unwrap_or_else(|_| "unknown".into());
    Ok(Json(CloudflaredInfo {
        path: state.core.supervisor.cloudflared_path.display().to_string(),
        version,
        logged_in: cert::is_logged_in(),
        cert_path: cert::cert_path().display().to_string(),
    }))
}
