use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: i64,
    pub hostname: String,
    pub service_url: String,
    pub tunnel_uuid: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewPageInput {
    pub hostname: String,
    pub service_url: String,
    pub tunnel_uuid: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PagePatch {
    pub hostname: Option<String>,
    pub service_url: Option<String>,
    pub tunnel_uuid: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tunnel {
    pub uuid: String,
    pub name: String,
    pub cred_path: String,
    pub managed: bool,
    pub last_seen: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub grouping_mode: String,           // "shared" | "isolated"
    pub shared_tunnel_uuid: Option<String>,
    pub cloudflared_path: Option<String>,
    pub theme: String,                   // "dark" | "light" | "system"
    pub start_on_boot: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SettingsPatch {
    pub grouping_mode: Option<String>,
    pub shared_tunnel_uuid: Option<String>,
    pub cloudflared_path: Option<String>,
    pub theme: Option<String>,
    pub start_on_boot: Option<bool>,
}
