//! Project wizard / store routes. Streaming routes (create, redeploy) return
//! an `eventId` JSON object; the client opens `GET /events/:id` to consume
//! progress. The actual work runs on a detached tokio task that writes to the
//! shared event bus.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};

use cf_tunnel_core::projects::{
    create::{self, CreateSpec, ProgressEvent},
    files, import as proj_import, inspect, redeploy, store, stop,
};
use cf_tunnel_core::scaffold;

use crate::error::ApiError;
use crate::events::StateEvent;
use crate::state::ConnectorState;

pub async fn list_templates() -> Result<Json<Vec<scaffold::Template>>, ApiError> {
    Ok(Json(scaffold::all()))
}

pub async fn list_projects(
    State(state): State<ConnectorState>,
) -> Result<Json<Vec<store::Project>>, ApiError> {
    let g = state.core.db.lock();
    Ok(Json(store::list(&g)?))
}

pub async fn delete_project(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
) -> Result<Json<()>, ApiError> {
    {
        let g = state.core.db.lock();
        store::delete(&g, id)?;
    }
    state.events.publish(StateEvent::ProjectsChanged);
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLiveUrlBody {
    pub deployed_url: Option<String>,
    pub custom_domain: Option<String>,
}

pub async fn update_live_url(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateLiveUrlBody>,
) -> Result<Json<store::Project>, ApiError> {
    let project = {
        let g = state.core.db.lock();
        store::update_live_url(&g, id, body.deployed_url.as_deref(), body.custom_domain.as_deref())?
    };
    state.events.publish(StateEvent::ProjectsChanged);
    Ok(Json(project))
}

pub async fn stop_project(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
) -> Result<Json<store::Project>, ApiError> {
    let p = stop::run(state.core.db.clone(), id).await?;
    state.events.publish(StateEvent::ProjectsChanged);
    Ok(Json(p))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderBody {
    pub folder: String,
}

pub async fn inspect_project_folder(
    Json(body): Json<FolderBody>,
) -> Result<Json<inspect::FolderInspection>, ApiError> {
    Ok(Json(inspect::inspect(std::path::Path::new(&body.folder))?))
}

pub async fn scan_wrangler_projects(
    Json(body): Json<FolderBody>,
) -> Result<Json<Vec<inspect::FolderInspection>>, ApiError> {
    Ok(Json(inspect::scan_wrangler_projects(std::path::Path::new(
        &body.folder,
    ))?))
}

pub async fn import_project(
    State(state): State<ConnectorState>,
    Json(spec): Json<proj_import::ImportSpec>,
) -> Result<Json<store::Project>, ApiError> {
    let p = proj_import::run(state.core.db.clone(), spec)?;
    state.events.publish(StateEvent::ProjectsChanged);
    Ok(Json(p))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventIdResponse {
    pub event_id: String,
}

pub async fn create_project(
    State(state): State<ConnectorState>,
    Json(spec): Json<CreateSpec>,
) -> Result<Json<EventIdResponse>, ApiError> {
    let (event_id, channel) = state.events.new_job(&spec.name);
    let db = state.core.db.clone();
    let bus = state.events.clone();
    let spec_clone = spec.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ProgressEvent>();
        let ch_for_pump = channel.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let Ok(v) = serde_json::to_value(&evt) {
                    ch_for_pump.push(v);
                }
            }
        });
        let outcome = create::run(spec_clone.clone(), tx).await;
        let _ = pump.await;

        if let Ok(out) = outcome {
            let g = db.lock();
            let _ = store::insert(
                &g,
                &spec_clone.name,
                &spec_clone.template_id,
                &out.folder.to_string_lossy(),
                out.url.as_deref(),
                spec_clone.custom_domain.as_deref(),
            );
            bus.publish(StateEvent::ProjectsChanged);
        }
        channel.finish();
    });

    Ok(Json(EventIdResponse { event_id }))
}

pub async fn redeploy_project(
    State(state): State<ConnectorState>,
    Path(id): Path<i64>,
) -> Result<Json<EventIdResponse>, ApiError> {
    let (event_id, channel) = state.events.new_job(&format!("redeploy-{id}"));
    let db = state.core.db.clone();
    let bus = state.events.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ProgressEvent>();
        let ch_for_pump = channel.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let Ok(v) = serde_json::to_value(&evt) {
                    ch_for_pump.push(v);
                }
            }
        });
        let result = redeploy::run(db, id, tx).await;
        let _ = pump.await;
        if let Err(e) = result {
            let err = ProgressEvent::Error {
                step: cf_tunnel_core::projects::create::Step::Deploy,
                message: e.to_string(),
            };
            if let Ok(v) = serde_json::to_value(&err) {
                channel.push(v);
            }
        }
        bus.publish(StateEvent::ProjectsChanged);
        channel.finish();
    });

    Ok(Json(EventIdResponse { event_id }))
}

// ── Project files ────────────────────────────────────────────────────────

pub async fn list_files(
    Json(body): Json<FolderBody>,
) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(files::list(std::path::Path::new(&body.folder))?))
}

#[derive(Deserialize)]
pub struct ReadFileBody {
    pub folder: String,
    pub rel: String,
}

pub async fn read_file(
    Json(body): Json<ReadFileBody>,
) -> Result<Json<String>, ApiError> {
    Ok(Json(files::read(std::path::Path::new(&body.folder), &body.rel)?))
}

#[derive(Deserialize)]
pub struct WriteFileBody {
    pub folder: String,
    pub rel: String,
    pub content: String,
}

pub async fn write_file(
    Json(body): Json<WriteFileBody>,
) -> Result<Json<()>, ApiError> {
    files::write(
        std::path::Path::new(&body.folder),
        &body.rel,
        &body.content,
    )?;
    Ok(Json(()))
}
