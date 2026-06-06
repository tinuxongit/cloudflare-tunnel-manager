//! SSE endpoints.
//!
//! * `GET /events`         — global realtime state-change feed
//! * `GET /events/:id`     — buffered per-job progress stream
//!
//! Both write `data: <json>\n\n` SSE frames. The client uses fetch streaming
//! (not browser EventSource) so it can attach `Authorization: Bearer …`,
//! which EventSource cannot.

use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures_util::{stream, Stream, StreamExt};
use tokio_stream::wrappers::BroadcastStream;

use crate::error::ApiError;
use crate::events::{JobChannel, StateEvent};
use crate::state::ConnectorState;

/// Per-job progress SSE. Stream stays open until the job is marked finished
/// AND the buffered queue is fully drained.
pub async fn job_stream(
    State(state): State<ConnectorState>,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    use cf_tunnel_core::error::AppError;
    let ch: Arc<JobChannel> = state.events.get_job(&id).ok_or_else(|| {
        ApiError(AppError::Other {
            message: format!("unknown event id: {id}"),
        })
    })?;

    // Initial state: cursor = 0. Each step drains [cursor..events.len()] into
    // a local buffer + emits one frame per loop turn.
    let init = (ch, 0usize, VecDeque::<serde_json::Value>::new());
    let s = stream::unfold(init, |(ch, mut cursor, mut pending)| async move {
        loop {
            if let Some(next) = pending.pop_front() {
                return Some((Ok(json_frame(&next)), (ch, cursor, pending)));
            }
            // Refill pending from the buffer.
            {
                let g = ch.events.lock();
                if cursor < g.len() {
                    pending.extend(g[cursor..].iter().cloned());
                    cursor = g.len();
                }
            }
            if !pending.is_empty() {
                continue;
            }
            if ch.is_finished() {
                return None;
            }
            ch.notify.notified().await;
        }
    });

    Ok(Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

/// Realtime state-change SSE. One channel per HTTP connection.
pub async fn state_stream(
    State(state): State<ConnectorState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.events.subscribe_state();
    let s = BroadcastStream::new(rx).filter_map(|item| async move {
        let evt: StateEvent = item.ok()?;
        let v = serde_json::to_value(&evt).ok()?;
        Some(Ok(json_frame(&v)))
    });
    Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

fn json_frame(v: &serde_json::Value) -> Event {
    Event::default().data(serde_json::to_string(v).unwrap_or_else(|_| "null".into()))
}

/// Stop a tail job — kill the underlying process AND mark the SSE channel
/// finished so its stream closes.
pub async fn stop_tail(
    State(state): State<ConnectorState>,
    Path(id): Path<String>,
) -> Result<Json<()>, ApiError> {
    if let Some(mut child) = state.tails.lock().remove(&id) {
        let _ = child.start_kill();
    }
    state.events.finish_job(&id);
    Ok(Json(()))
}
