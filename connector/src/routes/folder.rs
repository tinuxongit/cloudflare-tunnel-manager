use axum::Json;
use serde::Deserialize;

use cf_tunnel_core::local_server;
use cf_tunnel_core::local_server::detect::Detected;
use cf_tunnel_core::local_server::setup_guide;

use crate::error::ApiError;

#[derive(Deserialize)]
pub struct FolderPathBody {
    pub path: String,
}

pub async fn detect_folder(
    Json(body): Json<FolderPathBody>,
) -> Result<Json<Detected>, ApiError> {
    Ok(Json(local_server::detect(std::path::Path::new(&body.path))))
}

#[derive(Deserialize)]
pub struct SetupGuideBody {
    pub path: String,
}

pub async fn write_setup_guide(
    Json(body): Json<SetupGuideBody>,
) -> Result<Json<String>, ApiError> {
    let p = setup_guide::write_setup_guide(std::path::Path::new(&body.path))?;
    Ok(Json(p.display().to_string()))
}
