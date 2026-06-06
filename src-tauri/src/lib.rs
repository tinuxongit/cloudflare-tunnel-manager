pub mod commands;
pub mod mirror;

use tauri::Manager;
use cf_tunnel_core::state::AppState;
use cf_tunnel_core::cloudflared::cli::CloudflaredCli;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,cf_tunnel_manager=debug".into())
    ).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            commands::route_dns_via_api,
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
            commands::set_global_key,
            commands::clear_global_key,
            commands::has_global_key,
            commands::get_global_key,
            commands::detect_folder,
            commands::write_setup_guide,
            commands::get_local_logs,
            commands::local_is_running,
            commands::list_workers,
            commands::get_worker,
            commands::delete_worker,
            commands::list_d1_databases,
            commands::exec_d1,
            commands::delete_d1_database,
            commands::list_dns_records,
            commands::create_dns_record,
            commands::delete_dns_record,
            commands::purge_cache,
            commands::set_dev_mode,
            commands::get_dev_mode,
            commands::list_pages_projects,
            commands::list_pages_deployments,
            commands::list_templates,
            commands::list_projects,
            commands::delete_project,
            commands::update_project_live_url,
            commands::start_create_project,
            commands::redeploy_project,
            commands::pick_project_folder,
            commands::open_project_folder,
            commands::delete_project_folder,
            commands::open_in_editor,
            commands::http_request,
            commands::ping_url,
            commands::list_worker_secrets,
            commands::put_worker_secret,
            commands::delete_worker_secret,
            commands::list_r2_buckets,
            commands::create_r2_bucket,
            commands::delete_r2_bucket,
            commands::list_project_files,
            commands::read_project_file,
            commands::write_project_file,
            commands::start_project_tail,
            commands::stop_project_tail,
            commands::inspect_project_folder,
            commands::scan_wrangler_projects,
            commands::import_project,
            commands::detect_setup,
            commands::install_tool,
            commands::list_missing_tools,
            commands::install_all_tools,
            commands::stop_project,
            commands::browse_fs,
            mirror::mirror_sync_down,
            mirror::mirror_start_watch,
            mirror::mirror_stop_watch,
            mirror::mirror_delete_local,
            mirror::mirror_resolve,
            mirror::mirror_diff_status,
            mirror::mirror_diff_file,
            mirror::mirror_apply,
            mirror::mirror_cancel,
            mirror::mirror_live_diff,
            mirror::mirror_fetch_remote_text,
            mirror::mirror_apply_live,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
