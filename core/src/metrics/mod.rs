pub mod scraper;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
pub struct RuntimeStatus {
    pub state: &'static str,                 // "running" | "starting" | "error" | "stopped"
    pub connections: Option<u32>,
    pub edge_region: Option<String>,
    pub requests_per_s: Option<f64>,
    pub p50_ms: Option<f64>,
    pub errors_total: Option<u64>,
}
