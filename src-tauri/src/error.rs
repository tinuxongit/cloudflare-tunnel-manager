use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("cloudflared binary not found on PATH")]
    CloudflaredNotFound,
    #[error("cloudflared version {current} is below required {min_required}")]
    CloudflaredOutdated { current: String, min_required: String },
    #[error("cloudflared cert.pem not found — run `cloudflared tunnel login`")]
    NotLoggedIn,
    #[error("local service unreachable at {url}: {reason}")]
    LocalServiceDown { url: String, reason: String },
    #[error("tunnel {uuid} not found")]
    TunnelNotFound { uuid: String },
    #[error("hostname {hostname} already in use")]
    HostnameTaken { hostname: String },
    #[error("DNS route failed for {hostname}: {stderr}")]
    DnsRouteFailed { hostname: String, stderr: String },
    #[error("failed to write config {path}: {reason}")]
    ConfigWriteFailed { path: String, reason: String },
    #[error("failed to spawn cloudflared: {reason}")]
    ProcSpawnFailed { reason: String },
    #[error("metrics endpoint unreachable on port {port}")]
    MetricsUnreachable { port: u16 },
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{message}")]
    Other { message: String },
}

#[derive(Serialize)]
pub struct AppErrorPayload {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl From<&AppError> for AppErrorPayload {
    fn from(e: &AppError) -> Self {
        let code = match e {
            AppError::CloudflaredNotFound       => "CLOUDFLARED_NOT_FOUND",
            AppError::CloudflaredOutdated {..}  => "CLOUDFLARED_OUTDATED",
            AppError::NotLoggedIn               => "NOT_LOGGED_IN",
            AppError::LocalServiceDown {..}     => "LOCAL_SERVICE_DOWN",
            AppError::TunnelNotFound {..}       => "TUNNEL_NOT_FOUND",
            AppError::HostnameTaken {..}        => "HOSTNAME_TAKEN",
            AppError::DnsRouteFailed {..}       => "DNS_ROUTE_FAILED",
            AppError::ConfigWriteFailed {..}    => "CONFIG_WRITE_FAILED",
            AppError::ProcSpawnFailed {..}      => "PROC_SPAWN_FAILED",
            AppError::MetricsUnreachable {..}   => "METRICS_UNREACHABLE",
            AppError::Sqlite(_)                 => "SQLITE",
            AppError::Io(_)                     => "IO",
            AppError::Other {..}                => "OTHER",
        };
        AppErrorPayload {
            code: code.into(),
            message: e.to_string(),
            detail: None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        AppErrorPayload::from(self).serialize(s)
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
