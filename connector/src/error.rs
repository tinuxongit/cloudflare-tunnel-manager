use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use cf_tunnel_core::error::AppError;

pub struct ApiError(pub AppError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            AppError::CloudflaredNotFound => StatusCode::SERVICE_UNAVAILABLE,
            AppError::CloudflaredOutdated { .. } => StatusCode::SERVICE_UNAVAILABLE,
            AppError::NotLoggedIn => StatusCode::PRECONDITION_FAILED,
            AppError::LocalServiceDown { .. } => StatusCode::BAD_GATEWAY,
            AppError::TunnelNotFound { .. } => StatusCode::NOT_FOUND,
            AppError::HostnameTaken { .. } => StatusCode::CONFLICT,
            AppError::DnsRouteFailed { .. } => StatusCode::BAD_REQUEST,
            AppError::ConfigWriteFailed { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::ProcSpawnFailed { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::MetricsUnreachable { .. } => StatusCode::SERVICE_UNAVAILABLE,
            AppError::Sqlite(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Other { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = serde_json::to_string(&self.0).unwrap_or_else(|_| "{}".into());
        (
            status,
            [("content-type", "application/json")],
            body,
        )
            .into_response()
    }
}

impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        Self(e)
    }
}
