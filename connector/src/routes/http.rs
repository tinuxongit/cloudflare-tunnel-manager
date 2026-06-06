//! "Test API" + URL liveness ping — exposes core::http_tester over HTTP.

use axum::Json;
use serde::Deserialize;

use cf_tunnel_core::http_tester::{self, HttpRequestSpec, HttpResponse, PingResult};

use crate::error::ApiError;

#[derive(Deserialize)]
pub struct UrlBody {
    pub url: String,
}

pub async fn ping(Json(body): Json<UrlBody>) -> Result<Json<PingResult>, ApiError> {
    Ok(Json(http_tester::ping_url(&body.url).await?))
}

pub async fn request(
    Json(spec): Json<HttpRequestSpec>,
) -> Result<Json<HttpResponse>, ApiError> {
    Ok(Json(http_tester::http_request(spec).await?))
}
