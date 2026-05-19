use axum::Json;
use serde::Deserialize;

use cf_tunnel_core::health::{check::check as service_check, ServiceHealth};

use crate::error::ApiError;

#[derive(Deserialize)]
pub struct CheckLocalServiceBody {
    pub url: String,
}

pub async fn check_local_service(
    Json(body): Json<CheckLocalServiceBody>,
) -> Result<Json<ServiceHealth>, ApiError> {
    Ok(Json(service_check(&body.url).await))
}
