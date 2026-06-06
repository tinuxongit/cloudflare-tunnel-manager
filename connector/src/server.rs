use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};
use std::time::Duration;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::auth::require_bearer;
use crate::routes::{
    cloudflare, events, files, folder, fs, http, pages, projects, settings, setup, shell, status,
    system, tail, tunnels,
};
use crate::state::ConnectorState;

pub fn build(state: ConnectorState) -> Router {
    // axum 0.7 uses `:name` for path params, NOT `{name}` (that's 0.8+).
    // Routes with `{name}` are registered as literal strings with braces and
    // silently never match.
    let api = Router::new()
        // ── System ─────────────────────────────────────────────────────────
        .route("/system/health", get(system::health))
        .route("/system/cloudflared", get(system::cloudflared_info))
        // ── Pairing ────────────────────────────────────────────────────────
        .route("/pair/handshake/:code", get(system::handshake))
        // ── Realtime + per-job SSE ─────────────────────────────────────────
        .route("/events", get(events::state_stream))
        .route("/events/:id", get(events::job_stream))
        .route("/events/:id/stop", post(events::stop_tail))
        // ── Pages ──────────────────────────────────────────────────────────
        .route("/pages", get(pages::list_pages).post(pages::create_page))
        .route("/pages/:id", patch(pages::update_page).delete(pages::delete_page))
        .route("/pages/:id/toggle", post(pages::toggle_page))
        .route("/pages/:id/start-or-restart", post(pages::start_or_restart))
        .route("/pages/:id/local-logs", get(pages::local_logs))
        .route("/pages/:id/local-running", get(pages::local_running))
        // ── Tunnels ────────────────────────────────────────────────────────
        .route("/tunnels", get(tunnels::list_tunnels).post(tunnels::create_tunnel))
        .route("/tunnels/:uuid", delete(tunnels::delete_tunnel))
        .route("/tunnels/:uuid/stop", post(tunnels::stop_tunnel))
        .route("/tunnels/:uuid/status", get(tunnels::get_status))
        .route("/tunnels/:uuid/logs", get(tunnels::get_logs))
        // ── DNS via API ────────────────────────────────────────────────────
        .route("/dns/route", post(tunnels::route_dns_via_api))
        // ── Zones ──────────────────────────────────────────────────────────
        .route("/zones", get(tunnels::list_zones))
        // ── Workers ────────────────────────────────────────────────────────
        .route("/workers", get(cloudflare::list_workers))
        .route(
            "/workers/:id",
            get(cloudflare::get_worker).delete(cloudflare::delete_worker),
        )
        .route(
            "/workers/:id/secrets",
            get(cloudflare::list_worker_secrets).put(cloudflare::put_worker_secret),
        )
        .route("/workers/:id/secrets/:name", delete(cloudflare::delete_worker_secret))
        // ── R2 ─────────────────────────────────────────────────────────────
        .route(
            "/r2/buckets",
            get(cloudflare::list_r2_buckets).post(cloudflare::create_r2_bucket),
        )
        .route("/r2/buckets/:name", delete(cloudflare::delete_r2_bucket))
        // ── D1 ─────────────────────────────────────────────────────────────
        .route("/d1/databases", get(cloudflare::list_d1_databases))
        .route("/d1/databases/:uuid", delete(cloudflare::delete_d1_database))
        .route("/d1/databases/:uuid/query", post(cloudflare::exec_d1))
        // ── DNS records ────────────────────────────────────────────────────
        .route(
            "/dns/zones/:zone_id/records",
            get(cloudflare::list_dns_records).post(cloudflare::create_dns_record),
        )
        .route(
            "/dns/zones/:zone_id/records/:record_id",
            delete(cloudflare::delete_dns_record),
        )
        // ── Zone cache controls ────────────────────────────────────────────
        .route("/zones/:zone_id/purge-cache", post(cloudflare::purge_cache))
        .route(
            "/zones/:zone_id/dev-mode",
            get(cloudflare::get_dev_mode).post(cloudflare::set_dev_mode),
        )
        // ── Cloudflare Pages ───────────────────────────────────────────────
        .route("/cf-pages/projects", get(cloudflare::list_pages_projects))
        .route(
            "/cf-pages/projects/:project/deployments",
            get(cloudflare::list_pages_deployments),
        )
        // ── Settings ───────────────────────────────────────────────────────
        .route(
            "/settings",
            get(settings::get_settings).patch(settings::set_settings),
        )
        // ── Secrets: API token ─────────────────────────────────────────────
        .route("/secrets/api-token/exists", get(settings::has_api_token))
        .route(
            "/secrets/api-token",
            get(settings::get_api_token)
                .post(settings::set_api_token)
                .delete(settings::delete_api_token),
        )
        .route("/secrets/api-token/verify", post(settings::verify_api_token))
        // ── Secrets: Global key ────────────────────────────────────────────
        .route("/secrets/global-key/exists", get(settings::has_global_key))
        .route(
            "/secrets/global-key",
            get(settings::get_global_key)
                .post(settings::set_global_key)
                .delete(settings::delete_global_key),
        )
        // ── Credentials sync (one-shot push from manager after pairing) ────
        .route("/credentials/sync", post(settings::sync_credentials))
        // ── Folder detection (route-page setup) ────────────────────────────
        .route("/folder/detect", post(folder::detect_folder))
        .route("/folder/setup-guide", post(folder::write_setup_guide))
        // ── Local service health ───────────────────────────────────────────
        .route("/check-local-service", post(status::check_local_service))
        // ── Projects: store + wizard + redeploy + stop + import ────────────
        .route("/projects/templates", get(projects::list_templates))
        .route(
            "/projects",
            get(projects::list_projects).post(projects::create_project),
        )
        .route("/projects/:id", delete(projects::delete_project))
        .route("/projects/:id/live-url", patch(projects::update_live_url))
        .route("/projects/:id/redeploy", post(projects::redeploy_project))
        .route("/projects/:id/stop", post(projects::stop_project))
        .route("/projects/inspect", post(projects::inspect_project_folder))
        .route("/projects/scan", post(projects::scan_wrangler_projects))
        .route("/projects/import", post(projects::import_project))
        // ── Project files (editor) ─────────────────────────────────────────
        .route("/projects/files/list", post(projects::list_files))
        .route("/projects/files/read", post(projects::read_file))
        .route("/projects/files/write", put(projects::write_file))
        // ── Tail (wrangler tail subprocess) ────────────────────────────────
        .route("/projects/:id/tail", post(tail::start))
        // ── Setup detector + installer ─────────────────────────────────────
        .route("/setup/tools", get(setup::detect))
        .route("/setup/missing", get(setup::list_missing))
        .route("/setup/install-all", post(setup::install_all))
        .route("/setup/tools/:id/install", post(setup::install_tool))
        // ── Shell ops (open folder / editor / delete) ──────────────────────
        .route("/shell/open-folder", post(shell::open_folder))
        .route("/shell/open-editor", post(shell::open_in_editor))
        .route("/shell/delete-folder", post(shell::delete_folder))
        // ── HTTP tester ────────────────────────────────────────────────────
        .route("/debug/http", post(http::request))
        .route("/debug/ping", post(http::ping))
        // ── Remote filesystem browser ──────────────────────────────────────
        .route("/fs/browse", get(fs::browse))
        // ── Mirror file ops ────────────────────────────────────────────────
        .route("/files/walk", get(files::walk))
        .route(
            "/files/raw",
            get(files::download).put(files::upload).delete(files::delete),
        )
        .route("/files/mkdir", post(files::mkdir))
        .route("/files/rename", post(files::rename))
        // ── Shared state + auth middleware ─────────────────────────────────
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, require_bearer));

    Router::new()
        .nest("/", api)
        // Default body limit applies globally. axum's default is 2 MB which
        // is too small for the file-mirror uploads (PNG / video assets).
        // 500 MB lets reasonable static-site assets through; Cloudflare's
        // free Quick Tunnel itself caps around 100 MB so anything bigger
        // would hit a *tunnel-level* error rather than an axum 413.
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024))
        // CORS — Studio's only legitimate origins are the Tauri webview and
        // the Vite dev server. Bearer auth is the real gate, but pinning the
        // origin list closes the door on a hostile browser tab tricking the
        // user into making requests against their own connector URL.
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(|origin, _req| {
                    let Ok(s) = origin.to_str() else { return false };
                    matches!(
                        s,
                        "tauri://localhost"
                            | "https://tauri.localhost"
                            | "http://localhost:5173"
                            | "http://127.0.0.1:5173"
                    )
                }))
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers(Any)
                .max_age(Duration::from_secs(86400)),
        )
        // Log every request method + URI at INFO so 4xx/5xx investigations
        // don't require turning the RUST_LOG knob.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
}
