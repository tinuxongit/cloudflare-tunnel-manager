use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: i64,
    pub hostname: String,
    pub service_url: String,
    pub tunnel_uuid: String,
    pub enabled: bool,
    pub created_at: String,
    pub source_dir: Option<String>,
    pub run_command: Option<String>,
    pub assigned_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewPageInput {
    pub hostname: String,
    pub service_url: String,
    pub tunnel_uuid: String,
    #[serde(default)]
    pub source_dir: Option<String>,
    #[serde(default)]
    pub run_command: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PagePatch {
    pub hostname: Option<String>,
    pub service_url: Option<String>,
    pub tunnel_uuid: Option<String>,
    pub enabled: Option<bool>,
    pub source_dir: Option<String>,
    pub run_command: Option<String>,
    pub assigned_port: Option<u16>,
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
    pub grouping_mode: String,
    pub shared_tunnel_uuid: Option<String>,
    pub cloudflared_path: Option<String>,
    pub theme: String,
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
