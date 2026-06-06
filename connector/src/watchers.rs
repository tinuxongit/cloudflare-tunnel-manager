//! Background tasks that publish realtime state-change events independently
//! of any single HTTP route. So far: tunnel runtime-state diff poller.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use cf_tunnel_core::{metrics, state::AppState};

use crate::events::{EventBus, StateEvent};

/// Polls every supervised tunnel every 2 s. If a tunnel's runtime state
/// (running / starting / error / stopped) changes since the last tick, we
/// publish a `tunnel_status` event. Skipping unchanged states keeps the
/// realtime bus quiet under steady-state load.
pub fn spawn_tunnel_watcher(core: Arc<AppState>, bus: Arc<EventBus>) {
    tokio::spawn(async move {
        let mut last: HashMap<String, &'static str> = HashMap::new();
        let mut tick = tokio::time::interval(Duration::from_secs(2));
        loop {
            tick.tick().await;
            let tracked = core.supervisor.running_tunnels();
            // Drop entries the supervisor no longer tracks.
            last.retain(|k, _| tracked.contains(k));
            for uuid in &tracked {
                let state = resolve_state(&core, uuid).await;
                let prev = last.get(uuid).copied();
                if prev != Some(state) {
                    last.insert(uuid.clone(), state);
                    bus.publish(StateEvent::TunnelStatus {
                        uuid: uuid.clone(),
                        state: state.into(),
                    });
                }
            }
        }
    });
}

async fn resolve_state(core: &AppState, uuid: &str) -> &'static str {
    let Some(port) = core.supervisor.metrics_port(uuid) else {
        return "stopped";
    };
    if !core.supervisor.is_running(uuid) {
        return "error";
    }
    match metrics::scraper::fetch(port).await {
        Ok(s) => match s.state {
            "running" => "running",
            "starting" => "starting",
            "error" => "error",
            _ => "stopped",
        },
        Err(_) => "starting",
    }
}
