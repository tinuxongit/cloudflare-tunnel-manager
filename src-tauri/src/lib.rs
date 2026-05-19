pub mod error;
pub mod state;
pub mod commands;
pub mod db;
pub mod cloudflared;
pub mod supervisor;
pub mod metrics;
pub mod health;
pub mod secrets;

use tauri::Manager;
use crate::state::AppState;
use crate::cloudflared::cli::CloudflaredCli;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,cf_tunnel_manager=debug".into())
    ).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app_data_dir");
            // cloudflared path: from settings later; for now discover or fall back
            let cf_path = CloudflaredCli::discover()
                .map(|c| c.path)
                .unwrap_or_else(|_| std::path::PathBuf::from("cloudflared"));
            let state = AppState::init(data_dir, cf_path)
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_pages,
            commands::create_page,
            commands::update_page,
            commands::delete_page,
            commands::toggle_page,
            commands::list_tunnels,
            commands::create_tunnel,
            commands::delete_tunnel,
            commands::route_dns,
            commands::get_status,
            commands::get_logs,
            commands::stop_tunnel,
            commands::check_local_service,
            commands::cloudflared_info,
            commands::get_settings,
            commands::set_settings,
            commands::start_or_restart_for_page,
            commands::set_api_token,
            commands::clear_api_token,
            commands::has_api_token,
            commands::get_api_token,
            commands::list_zones,
            commands::verify_api_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
