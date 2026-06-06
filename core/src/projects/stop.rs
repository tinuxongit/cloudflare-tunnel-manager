//! Stop a project: delete its Worker on Cloudflare + null the deployed URL.
//! Folder, DB rows, and the project card itself stay; Deploy brings it back.

use std::sync::Arc;

use parking_lot::Mutex as PlMutex;
use rusqlite::Connection;

use crate::cloudflared::{api, workers};
use crate::error::AppResult;
use crate::projects::store::{self, Project};

pub async fn run(db: Arc<PlMutex<Connection>>, id: i64) -> AppResult<Project> {
    let project = {
        let g = db.lock();
        store::by_id(&g, id)?
    };
    let creds = api::resolve_credentials()?;
    // Delete the Worker — ignore "not found" so Stop is idempotent.
    let _ = workers::delete_worker(&creds, &project.name).await;
    let g = db.lock();
    store::clear_deployed_url(&g, id)
}
