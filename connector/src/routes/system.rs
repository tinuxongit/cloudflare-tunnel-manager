use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::Serialize;

use crate::state::{ConnectorState, HandshakeOutcome};

const HANDSHAKE_TTL_SECS: u64 = 30 * 60;

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

#[derive(Serialize)]
pub struct CloudflaredInfo {
    pub path: String,
    pub version: String,
}

pub async fn cloudflared_info(
    State(state): State<ConnectorState>,
) -> Result<Json<CloudflaredInfo>, (StatusCode, String)> {
    use cf_tunnel_core::cloudflared::cli::CloudflaredCli;

    let cli = CloudflaredCli::with_path(state.core.supervisor.cloudflared_path());
    let version = cli.version().unwrap_or_else(|_| "unknown".into());
    Ok(Json(CloudflaredInfo {
        path: state.core.supervisor.cloudflared_path().display().to_string(),
        version,
    }))
}

// ── Code-based handshake (token handover after the connector mints a code) ─

#[derive(Serialize)]
pub struct HandshakeResponse {
    pub token: String,
}

/// `GET /pair/handshake/:secret` — Studio calls this once after dialling in
/// over the connector's Quick Tunnel URL, to fetch the bearer token. The
/// secret is the 4-char tail of the paste code the connector prints on
/// startup; single-use, 30-minute TTL.
pub async fn handshake(
    State(state): State<ConnectorState>,
    axum::extract::Path(code): axum::extract::Path<String>,
) -> Result<Json<HandshakeResponse>, StatusCode> {
    tracing::info!("handshake attempt: code='{code}' (len={})", code.len());
    match state.handshake.consume(&code, HANDSHAKE_TTL_SECS) {
        HandshakeOutcome::Ok(token) => {
            tracing::info!("handshake OK for code='{code}'");
            Ok(Json(HandshakeResponse { token }))
        }
        HandshakeOutcome::Wrong { remaining } => {
            tracing::warn!("handshake wrong code (remaining attempts={remaining})");
            Err(StatusCode::UNAUTHORIZED)
        }
        HandshakeOutcome::Closed => {
            // Either expired, never populated, or just self-sealed after too
            // many wrong attempts. Indistinguishable to the client by design.
            tracing::warn!("handshake closed (expired or sealed)");
            Err(StatusCode::NOT_FOUND)
        }
    }
}
