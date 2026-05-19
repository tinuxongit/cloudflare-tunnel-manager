use std::sync::Arc;
use parking_lot::Mutex;

use cf_tunnel_core::state::AppState;

use crate::auth::PairingStore;
use crate::config::Config;

/// Shared state injected into every axum handler via `State<ConnectorState>`.
#[derive(Clone)]
pub struct ConnectorState {
    /// The core application state (DB, supervisor, local server, …).
    pub core: Arc<AppState>,
    /// Runtime-mutable config (paired token). Persisted on every write.
    pub config: Arc<Mutex<Config>>,
    /// In-memory pairing code TTL store.
    pub pairing: Arc<PairingStore>,
}

impl ConnectorState {
    pub fn new(core: Arc<AppState>, config: Config, pairing: Arc<PairingStore>) -> Self {
        Self {
            core,
            config: Arc::new(Mutex::new(config)),
            pairing,
        }
    }
}
