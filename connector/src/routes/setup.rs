//! Setup detection + tool installer. Install streams progress as SSE.

use axum::{
    extract::{Path, State},
    Json,
};

use cf_tunnel_core::projects::create::ProgressEvent;
use cf_tunnel_core::setup::{self, install, ToolStatus};

use crate::error::ApiError;
use crate::events::StateEvent;
use crate::routes::projects::EventIdResponse;
use crate::state::ConnectorState;

pub async fn detect() -> Result<Json<Vec<ToolStatus>>, ApiError> {
    Ok(Json(setup::detect_all()))
}

pub async fn install_tool(
    State(state): State<ConnectorState>,
    Path(tool_id): Path<String>,
) -> Result<Json<EventIdResponse>, ApiError> {
    let (event_id, channel) = state.events.new_job(&format!("install-{tool_id}"));
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
        let _ = install::run(tool_id, tx).await;
        let _ = pump.await;
        bus.publish(StateEvent::ToolsChanged);
        channel.finish();
    });

    Ok(Json(EventIdResponse { event_id }))
}

/// What `install_all` would touch, in install order. Lets the UI preview the
/// plan ("This will install Node + pnpm + cloudflared + git") before the user
/// commits.
pub async fn list_missing() -> Result<Json<Vec<ToolStatus>>, ApiError> {
    Ok(Json(install::missing_required()))
}

/// One-click install of every missing essential/recommended tool. Streams
/// all subprocess output through a single SSE job channel so the deploy
/// terminal shows the whole sequence as one continuous log.
pub async fn install_all(
    State(state): State<ConnectorState>,
) -> Result<Json<EventIdResponse>, ApiError> {
    let (event_id, channel) = state.events.new_job("install-all");
    let bus = state.events.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ProgressEvent>();
        let ch_for_pump = channel.clone();
        let bus_for_pump = bus.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                // Publish ToolsChanged on EVERY step boundary so the UI's
                // missing-tools list ticks down live, one entry at a time,
                // instead of jumping from "3 missing" to "done".
                if matches!(evt, ProgressEvent::StepDone { .. }) {
                    bus_for_pump.publish(StateEvent::ToolsChanged);
                }
                if let Ok(v) = serde_json::to_value(&evt) {
                    ch_for_pump.push(v);
                }
            }
        });
        let _ = install::run_all(tx).await;
        let _ = pump.await;
        // Final fan-out covers the case where the very last step didn't emit
        // a StepDone (errors mid-tool, etc.).
        bus.publish(StateEvent::ToolsChanged);
        channel.finish();
    });

    Ok(Json(EventIdResponse { event_id }))
}
