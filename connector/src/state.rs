use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;

use cf_tunnel_core::state::AppState;

use crate::config::Config;
use crate::events::EventBus;

/// Tail jobs: a `wrangler tail` child process per job_id. Stored separately
/// from the event bus so `stop_project_tail` can kill the OS process; the
/// bus only owns the event stream.
pub type TailRegistry = Mutex<HashMap<String, tokio::process::Child>>;

/// One-shot bearer-token handover after the connector mints its paste code.
/// `put()` is called on startup with the secret tail of the paste code; the
/// `GET /pair/handshake/:secret` route consumes it once when Studio dials in.
#[derive(Clone, Default)]
pub struct HandshakeSlot {
    pub inner: std::sync::Arc<Mutex<Option<HandshakeEntry>>>,
}

#[derive(Clone)]
pub struct HandshakeEntry {
    pub code: String,
    pub token: String,
    pub created_at: std::time::Instant,
    /// Wrong-code attempts since `put()`. Slot self-seals at MAX_BAD_ATTEMPTS
    /// to defang brute force against the 4-char secret.
    pub bad_attempts: u32,
}

/// After this many wrong codes, the slot is wiped without further checks —
/// the user has to re-run the connector to mint a fresh code. With a 4-char
/// secret (~1M space) this caps brute force at ~5 guesses regardless of
/// network speed.
const MAX_BAD_ATTEMPTS: u32 = 5;

pub enum HandshakeOutcome {
    Ok(String),
    /// Code didn't match (or wasn't present). `remaining` is how many tries
    /// the caller has left before the slot self-seals.
    Wrong { remaining: u32 },
    /// Slot is empty, expired, or sealed.
    Closed,
}

impl HandshakeSlot {
    pub fn put(&self, code: String, token: String) {
        *self.inner.lock() = Some(HandshakeEntry {
            code,
            token,
            created_at: std::time::Instant::now(),
            bad_attempts: 0,
        });
    }

    /// Take the token IF the code matches AND the entry isn't older than
    /// `max_age_secs`. Single-use on success; on N consecutive wrong codes
    /// the slot is sealed regardless of remaining TTL.
    pub fn consume(&self, code: &str, max_age_secs: u64) -> HandshakeOutcome {
        let mut g = self.inner.lock();
        let Some(entry) = g.as_mut() else { return HandshakeOutcome::Closed };
        if entry.created_at.elapsed().as_secs() > max_age_secs {
            *g = None;
            return HandshakeOutcome::Closed;
        }
        if entry.code == code {
            let token = entry.token.clone();
            *g = None;
            return HandshakeOutcome::Ok(token);
        }
        entry.bad_attempts += 1;
        if entry.bad_attempts >= MAX_BAD_ATTEMPTS {
            *g = None;
            return HandshakeOutcome::Closed;
        }
        HandshakeOutcome::Wrong {
            remaining: MAX_BAD_ATTEMPTS - entry.bad_attempts,
        }
    }
}

/// Shared state injected into every axum handler via `State<ConnectorState>`.
#[derive(Clone)]
pub struct ConnectorState {
    /// The core application state (DB, supervisor, local server, …).
    pub core: Arc<AppState>,
    /// Runtime-mutable config (paired token). Persisted on every write.
    pub config: Arc<Mutex<Config>>,
    /// SSE event bus for job streams + realtime state-change broadcast.
    pub events: Arc<EventBus>,
    /// Tail subprocess registry, keyed by job id.
    pub tails: Arc<TailRegistry>,
    /// Code-gated one-shot token handover.
    pub handshake: HandshakeSlot,
}

impl ConnectorState {
    pub fn new(core: Arc<AppState>, config: Config) -> Self {
        Self {
            core,
            config: Arc::new(Mutex::new(config)),
            events: EventBus::new(),
            tails: Arc::new(Mutex::new(HashMap::new())),
            handshake: HandshakeSlot::default(),
        }
    }
}
