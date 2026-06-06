//! Native shell ops on the connector host: open folder / editor, delete a
//! folder. Useful when the connector runs on a desktop OS; harmless no-ops
//! on a headless server (errors swallowed for open_folder/open_in_editor).

use axum::Json;
use serde::Deserialize;

use cf_tunnel_core::shell;

use crate::error::ApiError;

#[derive(Deserialize)]
pub struct PathBody {
    pub path: String,
}

#[derive(Deserialize)]
pub struct FolderBody {
    pub folder: String,
}

pub async fn open_folder(Json(body): Json<PathBody>) -> Result<Json<()>, ApiError> {
    // Soft-fail: on a headless server the file manager isn't installed; we
    // still return Ok so the UI button is not noisy.
    let _ = shell::open_folder(&body.path);
    Ok(Json(()))
}

pub async fn open_in_editor(Json(body): Json<PathBody>) -> Result<Json<()>, ApiError> {
    let _ = shell::open_in_editor(&body.path);
    Ok(Json(()))
}

pub async fn delete_folder(Json(body): Json<FolderBody>) -> Result<Json<()>, ApiError> {
    shell::delete_folder(&body.folder)?;
    Ok(Json(()))
}
