//! Remote filesystem browser — backs the remote folder picker in the UI.

use axum::{extract::Query, Json};
use serde::Deserialize;

use cf_tunnel_core::fs_browse::{self, BrowseResult};

use crate::error::ApiError;

#[derive(Deserialize)]
pub struct BrowseQuery {
    pub path: Option<String>,
}

pub async fn browse(Query(q): Query<BrowseQuery>) -> Result<Json<BrowseResult>, ApiError> {
    Ok(Json(fs_browse::browse(q.path.as_deref())?))
}
