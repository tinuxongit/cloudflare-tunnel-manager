use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
};
use parking_lot::Mutex;
use rand::Rng;

use crate::state::ConnectorState;

/// In-memory pairing code store (TTL 10 minutes).
#[derive(Debug, Clone)]
pub struct PairingStore {
    inner: Arc<Mutex<Option<PairingEntry>>>,
}

#[derive(Debug, Clone)]
struct PairingEntry {
    code: String,
    issued_at: Instant,
}

impl PairingStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// Issue a fresh pairing code, replacing any previous one.
    pub fn issue(&self) -> String {
        let code = new_pairing_code();
        *self.inner.lock() = Some(PairingEntry {
            code: code.clone(),
            issued_at: Instant::now(),
        });
        code
    }

    /// Consume the code if it matches and has not expired. Returns true on success.
    pub fn consume(&self, candidate: &str) -> bool {
        let mut g = self.inner.lock();
        if let Some(entry) = g.as_ref() {
            let expired = entry.issued_at.elapsed() > Duration::from_secs(600);
            let matches = !expired && entry.code == candidate;
            if matches {
                *g = None;
                return true;
            }
        }
        false
    }

    /// Return the current pending code (if any) — used by show-code CLI command.
    pub fn current_code(&self) -> Option<String> {
        let g = self.inner.lock();
        g.as_ref().map(|e| e.code.clone())
    }
}

/// Generate a fresh 8-char pairing code with dashes: "4719-23PX".
pub fn new_pairing_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    let part1: String = (0..4)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect();
    let part2: String = (0..4)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect();
    format!("{part1}-{part2}")
}

/// Generate a 32-byte (64 hex chars) random token.
pub fn new_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

/// Axum middleware: require Authorization: Bearer <token> for all routes
/// except GET /system/health and POST /pair.
pub async fn require_bearer(
    State(state): State<ConnectorState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = req.uri().path();
    let method = req.method().as_str();

    // Open endpoints
    if (path == "/system/health" && method == "GET")
        || (path == "/pair" && method == "POST")
    {
        return Ok(next.run(req).await);
    }

    let expected = {
        let cfg = state.config.lock();
        cfg.paired_token.clone()
    };

    let Some(expected_token) = expected else {
        // Unpaired — reject all protected routes
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
