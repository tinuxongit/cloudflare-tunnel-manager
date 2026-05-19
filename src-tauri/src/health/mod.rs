pub mod check;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ServiceHealth {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub http_status: Option<u16>,
    pub reason: Option<String>,
}
