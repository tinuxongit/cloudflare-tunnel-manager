//! Start a `wrangler tail` live-logs subprocess. Returns an event_id; client
//! opens `GET /events/:id` to consume the JSON-per-event SSE stream. Stop via
//! `POST /events/:id/stop` (handler lives in `routes::events`).

use std::process::Stdio;

use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};

use cf_tunnel_core::{error::AppError, projects::store, wrangler};

use crate::error::ApiError;
use crate::routes::projects::EventIdResponse;
use crate::state::ConnectorState;

pub async fn start(
    State(state): State<ConnectorState>,
    Path(project_id): Path<i64>,
) -> Result<Json<EventIdResponse>, ApiError> {
    let project = {
        let g = state.core.db.lock();
        store::by_id(&g, project_id)?
    };
    let folder = std::path::PathBuf::from(&project.folder);
    let wrangler_bin = wrangler::locate_wrangler(&folder)?;

    let mut cmd = tokio::process::Command::new(&wrangler_bin);
    cmd.args(["tail", project.name.as_str(), "--format=json"])
        .current_dir(&folder)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        // If the connector itself exits, drop the child so we don't leave
        // an orphaned wrangler holding its own auth token.
        .kill_on_drop(true);
    for (k, v) in wrangler::cf_env_vars() {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| AppError::Other {
        message: format!("spawn wrangler tail: {e}"),
    })?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let (event_id, channel) = state.events.new_job(&format!("tail-{project_id}"));

    let ch_out = channel.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let payload = serde_json::from_str::<serde_json::Value>(&line)
                .unwrap_or_else(|_| json!({ "raw": line }));
            ch_out.push(payload);
        }
    });
    let ch_err = channel.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            ch_err.push(json!({ "info": line }));
        }
    });

    // Join task: when wrangler exits on its own (network drop, project gone,
    // auth lapsed), close the SSE stream and drop the registry handle so we
    // don't leave a zombie + a permanently-open EventSource. The two reader
    // tasks above complete naturally when stdout/stderr close.
    let ch_done = channel.clone();
    let tails = state.tails.clone();
    let id_for_cleanup = event_id.clone();
    tokio::spawn(async move {
        let mut child = match tails.lock().remove(&id_for_cleanup) {
            Some(c) => c,
            None => return, // already removed by stop_tail
        };
        let exit = child.wait().await;
        // Put nothing back; insertion below is gone too.
        match exit {
            Ok(s) => ch_done.push(json!({ "info": format!("(wrangler exited: {s})") })),
            Err(e) => ch_done.push(json!({ "info": format!("(wrangler wait failed: {e})") })),
        }
        ch_done.finish();
    });

    // Insert AFTER spawning the join task — the join task pulls it out and
    // owns the wait. If it can't find the entry (because stop_tail removed
    // it first), it exits silently.
    state.tails.lock().insert(event_id.clone(), child);

    Ok(Json(EventIdResponse { event_id }))
}
