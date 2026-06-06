//! Built-in static file server. Spawned in-process per page when the run
//! command is the EMBEDDED_STATIC sentinel — replaces `npx serve` and
//! the ~150 MB Node hit that comes with it.

use std::path::PathBuf;
use std::net::SocketAddr;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

pub struct StaticServerHandle {
    pub port: u16,
    pub stop: oneshot::Sender<()>,
    pub task: tokio::task::JoinHandle<()>,
}

/// Spawn an axum server bound to `127.0.0.1:port` that serves `dir`.
/// Returns the handle holding a shutdown signal.
pub async fn spawn(dir: PathBuf, port: u16) -> std::io::Result<StaticServerHandle> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let serve = ServeDir::new(&dir).append_index_html_on_directories(true);
    let app = axum::Router::new().fallback_service(serve);
    let (tx, rx) = oneshot::channel::<()>();
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move { let _ = rx.await; })
            .await;
    });
    Ok(StaticServerHandle { port, stop: tx, task })
}

pub fn shutdown(h: StaticServerHandle) {
    let _ = h.stop.send(());
    // Do not wait here, but tear the listener down promptly so restarting on
    // the same assigned port does not race the graceful task.
    h.task.abort();
}
