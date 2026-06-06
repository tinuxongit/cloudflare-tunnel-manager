//! Import an existing wrangler.toml folder as a project row.
//! Lives in core so the connector can expose it identically.

use std::sync::Arc;

use parking_lot::Mutex as PlMutex;
use rusqlite::Connection;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::projects::store::{self, Project};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSpec {
    pub folder: String,
    pub name: String,
    pub template_id: String,
    pub deployed_url: Option<String>,
    pub custom_domain: Option<String>,
}

pub fn run(db: Arc<PlMutex<Connection>>, spec: ImportSpec) -> AppResult<Project> {
    let g = db.lock();
    let result = store::insert(
        &g,
        &spec.name,
        &spec.template_id,
        &spec.folder,
        spec.deployed_url.as_deref(),
        spec.custom_domain.as_deref(),
    );
    match result {
        Ok(p) => Ok(p),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("UNIQUE") && msg.contains("folder") {
                store::update_import_by_folder(
                    &g,
                    &spec.folder,
                    &spec.name,
                    &spec.template_id,
                    spec.deployed_url.as_deref(),
                    spec.custom_domain.as_deref(),
                )
            } else {
                Err(e)
            }
        }
    }
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") && msg.contains("folder") {
            AppError::Other {
                message: format!(
                    "This folder is already imported. Look for it in the Projects list (folder: {}).",
                    spec.folder
                ),
            }
        } else {
            e
        }
    })
}
