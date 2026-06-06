use serde::{Deserialize, Deserializer, Serialize};

/// Distinguishes "field missing" (None) from "field present and null" (Some(None))
/// for patch deserialization. Without this, Option<String> collapses both cases
/// to None and a JSON `null` cannot clear a stored value.
fn deserialize_some<'de, T, D>(d: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    T::deserialize(d).map(Some)
}

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
    #[serde(default, deserialize_with = "deserialize_some")]
    pub source_dir: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub run_command: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub assigned_port: Option<Option<u16>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tunnel {
    pub uuid: String,
    pub name: String,
    /// Legacy field — used by the old CLI flow to point at a credentials.json
    /// on disk. Always empty in the API/token flow. We keep it as a private
    /// struct field for back-compat with existing user DBs (the `cred_path`
    /// column is NOT NULL in the schema), but hide it from the JSON surface
    /// so frontend code can't accidentally rely on it.
    #[serde(skip)]
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
    #[serde(default, deserialize_with = "deserialize_some")]
    pub shared_tunnel_uuid: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub cloudflared_path: Option<Option<String>>,
    pub theme: Option<String>,
    pub start_on_boot: Option<bool>,
}
