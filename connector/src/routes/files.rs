//! Generic file-mirror endpoints. Studio uses these to mirror a remote
//! folder onto a local laptop folder + push changes back.
//!
//! All endpoints take `root` (absolute path on the server) + `rel` (path
//! inside the root) so the same handlers serve any folder, not just project
//! folders. Path traversal is hardened in `core::fs_ops::safe_join`.

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use cf_tunnel_core::fs_ops::{self, Entry};

use crate::error::ApiError;
use crate::state::ConnectorState;

#[derive(Deserialize)]
pub struct RootQuery {
    pub root: String,
}

pub async fn walk(Query(q): Query<RootQuery>) -> Result<Json<Vec<Entry>>, ApiError> {
    Ok(Json(fs_ops::walk(std::path::Path::new(&q.root))?))
}

#[derive(Deserialize)]
pub struct ReadQuery {
    pub root: String,
    pub rel: String,
}

pub async fn download(Query(q): Query<ReadQuery>) -> Result<Response, ApiError> {
    let bytes = fs_ops::read_bytes(std::path::Path::new(&q.root), &q.rel)?;
    // Best-effort content type — Studio's editor handles text decoding; for
    // anything binary the user is downloading raw bytes.
    let mime = mime_for(&q.rel);
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
pub struct WriteQuery {
    pub root: String,
    pub rel: String,
}

/// PUT raw bytes. Caller picks content-type; we just store the body.
pub async fn upload(
    State(_state): State<ConnectorState>,
    Query(q): Query<WriteQuery>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    fs_ops::write_bytes(std::path::Path::new(&q.root), &q.rel, &body)?;
    Ok(Json(()))
}

pub async fn delete(Query(q): Query<ReadQuery>) -> Result<Json<()>, ApiError> {
    fs_ops::delete(std::path::Path::new(&q.root), &q.rel)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct MkdirBody {
    pub root: String,
    pub rel: String,
}

pub async fn mkdir(Json(b): Json<MkdirBody>) -> Result<Json<()>, ApiError> {
    fs_ops::mkdir(std::path::Path::new(&b.root), &b.rel)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct RenameBody {
    pub root: String,
    pub from: String,
    pub to: String,
}

pub async fn rename(Json(b): Json<RenameBody>) -> Result<Json<()>, ApiError> {
    fs_ops::rename(std::path::Path::new(&b.root), &b.from, &b.to)?;
    Ok(Json(()))
}

fn mime_for(rel: &str) -> &'static str {
    let lower = rel.to_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") { "text/html; charset=utf-8" }
    else if lower.ends_with(".css") { "text/css; charset=utf-8" }
    else if lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs") { "application/javascript; charset=utf-8" }
    else if lower.ends_with(".ts") || lower.ends_with(".tsx") { "text/typescript; charset=utf-8" }
    else if lower.ends_with(".json") { "application/json; charset=utf-8" }
    else if lower.ends_with(".md") || lower.ends_with(".txt") { "text/plain; charset=utf-8" }
    else if lower.ends_with(".png") { "image/png" }
    else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") { "image/jpeg" }
    else if lower.ends_with(".gif") { "image/gif" }
    else if lower.ends_with(".svg") { "image/svg+xml" }
    else if lower.ends_with(".webp") { "image/webp" }
    else if lower.ends_with(".ico") { "image/x-icon" }
    else { "application/octet-stream" }
}
