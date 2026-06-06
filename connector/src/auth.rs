use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
};
use rand::Rng;

use crate::state::ConnectorState;

/// Generate a 32-byte (64 hex chars) random token.
pub fn new_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

/// Axum middleware. Open endpoints are `GET /system/health` and the code-gated
/// `GET /pair/handshake/:code` (the studio uses it to fetch the bearer token
/// once after dialling in via the connector's Quick Tunnel URL). Everything
/// else requires `Authorization: Bearer <paired_token>`.
pub async fn require_bearer(
    State(state): State<ConnectorState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = req.uri().path();
    let method = req.method().as_str();

    if (path == "/system/health" && method == "GET")
        || (path.starts_with("/pair/handshake/") && method == "GET")
    {
        return Ok(next.run(req).await);
    }

    let expected = {
        let cfg = state.config.lock();
        cfg.paired_token.clone()
    };

    let Some(expected_token) = expected else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match auth_header {
        Some(token) if token == expected_token => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
