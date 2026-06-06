//! SSE event infrastructure.
//!
//! Two complementary streams:
//!
//! 1. **Job channels** — keyed by event id, used by long-running unary jobs
//!    (project create / redeploy, install_tool, wrangler tail). The HTTP
//!    handler returns an event_id; the client opens `GET /events/:id` to
//!    consume the stream until a terminal event arrives. Events are buffered
//!    so the consumer can attach after the work started without missing
//!    earlier output.
//!
//! 2. **Realtime bus** — single broadcast channel for state-change events
//!    (`pages.changed`, `tunnels.changed`, …). Every mutating route fires
//!    one; the client opens `GET /events` once and refetches affected
//!    slices when it sees the corresponding kind.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::Value;
use tokio::sync::{broadcast, Notify};

/// One buffered channel of progress events for a single job (create / install / tail).
pub struct JobChannel {
    pub events: Mutex<Vec<Value>>,
    pub notify: Notify,
    pub finished: Mutex<bool>,
    pub created_at: Instant,
}

impl JobChannel {
    fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
            notify: Notify::new(),
            finished: Mutex::new(false),
            created_at: Instant::now(),
        }
    }

    pub fn push(&self, v: Value) {
        self.events.lock().push(v);
        self.notify.notify_waiters();
    }

    pub fn finish(&self) {
        *self.finished.lock() = true;
        self.notify.notify_waiters();
    }

    pub fn is_finished(&self) -> bool {
        *self.finished.lock()
    }
}

/// Topics on the realtime state-change bus. Each variant maps to a JSON
/// `{"kind": "...", ...optional_fields}` payload the client uses to decide
/// what slice of state to refetch.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StateEvent {
    PagesChanged,
    TunnelsChanged,
    TunnelStatus { uuid: String, state: String },
    ProjectsChanged,
    SettingsChanged,
    SecretsChanged,
    ToolsChanged,
    WorkersChanged,
    R2Changed,
    D1Changed,
    DnsChanged,
}

/// Single in-process event bus shared by all handlers.
pub struct EventBus {
    jobs: Mutex<HashMap<String, Arc<JobChannel>>>,
    state: broadcast::Sender<StateEvent>,
    /// Monotonic counter appended to job ids — guarantees uniqueness when
    /// two calls land in the same millisecond.
    job_seq: AtomicU64,
}

impl EventBus {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(256);
        let bus = Arc::new(Self {
            jobs: Mutex::new(HashMap::new()),
            state: tx,
            job_seq: AtomicU64::new(0),
        });
        // Spawn a janitor that drops finished channels older than 10 min so
        // memory doesn't grow unbounded on a long-running connector.
        let weak = Arc::downgrade(&bus);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                let Some(b) = weak.upgrade() else { break };
                let mut g = b.jobs.lock();
                g.retain(|_, ch| {
                    !(ch.is_finished() && ch.created_at.elapsed() > Duration::from_secs(600))
                });
            }
        });
        bus
    }

    /// Allocate a fresh job channel + return the new id and the channel handle.
    pub fn new_job(&self, prefix: &str) -> (String, Arc<JobChannel>) {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let seq = self.job_seq.fetch_add(1, Ordering::Relaxed);
        let id = format!("{prefix}-{millis}-{seq}");
        let ch = Arc::new(JobChannel::new());
        self.jobs.lock().insert(id.clone(), ch.clone());
        (id, ch)
    }

    pub fn get_job(&self, id: &str) -> Option<Arc<JobChannel>> {
        self.jobs.lock().get(id).cloned()
    }

    /// Stop a tail job: just mark its channel finished. The actual child
    /// process is killed via the handle the spawner stashed separately.
    pub fn finish_job(&self, id: &str) {
        if let Some(ch) = self.jobs.lock().get(id) {
            ch.finish();
        }
    }

    /// Publish a state-change event. Failures are ignored — broadcast only
    /// errors when there are zero subscribers, which is normal when no UI is
    /// connected.
    pub fn publish(&self, evt: StateEvent) {
        let _ = self.state.send(evt);
    }

    pub fn subscribe_state(&self) -> broadcast::Receiver<StateEvent> {
        self.state.subscribe()
    }
}
