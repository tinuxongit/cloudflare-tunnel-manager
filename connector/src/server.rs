use axum::{
    middleware,
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::auth::require_bearer;
use crate::routes::{folder, pages, settings, status, system, tunnels};
use crate::state::ConnectorState;

pub fn build(state: ConnectorState) -> Router {
    let api = Router::new()
        // ── System ─────────────────────────────────────────────────────────
        .route("/system/health", get(system::health))
        .route("/system/cloudflared", get(system::cloudflared_info))
        // ── Pairing ────────────────────────────────────────────────────────
        .route("/pair", post(system::pair))
        // ── Pages ──────────────────────────────────────────────────────────
        .route("/pages", get(pages::list_pages).post(pages::create_page))
        .route(
            "/pages/{id}",
            patch(pages::update_page).delete(pages::delete_page),
        )
        .route("/pages/{id}/toggle", post(pages::toggle_page))
        .route("/pages/{id}/start-or-restart", post(pages::start_or_restart))
        .route("/pages/{id}/local-logs", get(pages::local_logs))
        .route("/pages/{id}/local-running", get(pages::local_running))
        // ── Tunnels ────────────────────────────────────────────────────────
        .route(
            "/tunnels",
            get(tunnels::list_tunnels).post(tunnels::create_tunnel),
        )
        .route(
            "/tunnels/{uuid}",
            delete(tunnels::delete_tunnel),
        )
        .route("/tunnels/{uuid}/route-dns", post(tunnels::route_dns))
        .route("/tunnels/{uuid}/stop", post(tunnels::stop_tunnel))
        .route("/tunnels/{uuid}/status", get(tunnels::get_status))
        .route("/tunnels/{uuid}/logs", get(tunnels::get_logs))
        // ── DNS via API ────────────────────────────────────────────────────
        .route("/dns/route", post(tunnels::route_dns_via_api))
        // ── Zones ──────────────────────────────────────────────────────────
        .route("/zones", get(tunnels::list_zones))
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
        // ── Folder detection ───────────────────────────────────────────────
        .route("/folder/detect", post(folder::detect_folder))
        .route("/folder/setup-guide", post(folder::write_setup_guide))
        // ── Local service health ───────────────────────────────────────────
        .route("/check-local-service", post(status::check_local_service))
        // ── Shared state + auth middleware ─────────────────────────────────
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, require_bearer));

    Router::new()
        .nest("/", api)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
