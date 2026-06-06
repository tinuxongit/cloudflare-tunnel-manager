use tauri::{State, AppHandle, Emitter};
use cf_tunnel_core::state::AppState;
use cf_tunnel_core::db::models::*;
use cf_tunnel_core::db::queries;
use cf_tunnel_core::error::{AppError, AppResult};

#[tauri::command]
pub fn list_pages(state: State<AppState>) -> AppResult<Vec<Page>> {
    let g = state.db.lock();
    queries::list_pages(&g)
}

#[tauri::command]
pub fn create_page(state: State<AppState>, input: NewPageInput) -> AppResult<Page> {
    let g = state.db.lock();
    queries::insert_page(&g, &input)
}

#[tauri::command]
pub fn update_page(state: State<AppState>, id: i64, patch: PagePatch) -> AppResult<Page> {
    let g = state.db.lock();
    queries::update_page(&g, id, &patch)
}

#[tauri::command]
pub fn delete_page(state: State<AppState>, id: i64) -> AppResult<()> {
    let g = state.db.lock();
    queries::delete_page(&g, id)
}

#[tauri::command]
pub fn toggle_page(state: State<AppState>, id: i64, on: bool) -> AppResult<Page> {
    let g = state.db.lock();
    let patch = PagePatch { enabled: Some(on), ..Default::default() };
    queries::update_page(&g, id, &patch)
}

use cf_tunnel_core::cloudflared::cli::CloudflaredCli;

#[tauri::command]
pub async fn list_tunnels(state: State<'_, AppState>) -> AppResult<Vec<Tunnel>> {
    let creds = cf_tunnel_core::cloudflared::api::resolve_credentials()?;
    let mut fresh = cf_tunnel_core::cloudflared::api::list_tunnels(&creds).await?;
    {
        let g = state.db.lock();
        for t in &fresh { queries::upsert_tunnel(&g, t)?; }
    }
    let g = state.db.lock();
    let cached = queries::list_tunnels(&g)?;
    for t in &mut fresh {
        if let Some(c) = cached.iter().find(|c| c.uuid == t.uuid) {
            t.managed = c.managed;
        }
    }
    Ok(fresh)
}

#[tauri::command]
pub async fn create_tunnel(state: State<'_, AppState>, name: String) -> AppResult<Tunnel> {
    let creds = cf_tunnel_core::cloudflared::api::resolve_credentials()?;
    let mut t = cf_tunnel_core::cloudflared::api::create_tunnel(&creds, &name).await?;
    t.managed = true;
    let g = state.db.lock();
    queries::upsert_tunnel(&g, &t)?;
    Ok(t)
}

#[tauri::command]
pub async fn delete_tunnel(state: State<'_, AppState>, uuid: String) -> AppResult<()> {
    let creds = cf_tunnel_core::cloudflared::api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::api::delete_tunnel(&creds, &uuid).await?;
    let g = state.db.lock();
    queries::delete_tunnel(&g, &uuid)
}


/// Create or replace the tunnel CNAME on a specific zone via the Cloudflare REST API.
/// Bypasses cloudflared's flaky zone-guessing — the caller picks the exact zone.
/// Requires the saved API token to have Zone:DNS:Edit permission.
#[tauri::command]
pub async fn route_dns_via_api(
    zone_id: String,
    hostname: String,
    tunnel_uuid: String,
    overwrite: Option<bool>,
) -> AppResult<()> {
    let creds = cf_tunnel_core::cloudflared::api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::api::upsert_tunnel_cname(
        &creds, &zone_id, &hostname, &tunnel_uuid, overwrite.unwrap_or(false),
    ).await
}

use cf_tunnel_core::metrics::{self, RuntimeStatus};
use cf_tunnel_core::supervisor::log_buffer::LogLine;
use cf_tunnel_core::health::{check::check as service_check, ServiceHealth};
use serde::Serialize;

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>, tunnel_uuid: String) -> AppResult<RuntimeStatus> {
    let port = state.supervisor.metrics_port(&tunnel_uuid);
    match port {
        None => Ok(RuntimeStatus { state: "stopped", ..Default::default() }),
        Some(p) => {
            if !state.supervisor.is_running(&tunnel_uuid) {
                return Ok(RuntimeStatus { state: "error", ..Default::default() });
            }
            match metrics::scraper::fetch(p).await {
                Ok(s) => Ok(s),
                Err(_) => Ok(RuntimeStatus { state: "starting", ..Default::default() }),
            }
        }
    }
}

#[tauri::command]
pub fn get_logs(state: State<AppState>, tunnel_uuid: String, last_n: usize) -> AppResult<Vec<LogLine>> {
    Ok(state.supervisor.logs(&tunnel_uuid, last_n))
}

#[tauri::command]
pub fn stop_tunnel(state: State<AppState>, uuid: String) -> AppResult<()> {
    state.supervisor.stop(&uuid);
    Ok(())
}

#[tauri::command]
pub async fn check_local_service(url: String) -> AppResult<ServiceHealth> {
    Ok(service_check(&url).await)
}

#[derive(Serialize)]
pub struct CloudflaredInfo {
    pub path: String,
    pub version: String,
}

#[tauri::command]
pub fn cloudflared_info(state: State<AppState>) -> AppResult<CloudflaredInfo> {
    let cli = CloudflaredCli::with_path(state.supervisor.cloudflared_path());
    let version = cli.version().unwrap_or_else(|_| "unknown".into());
    Ok(CloudflaredInfo {
        path: state.supervisor.cloudflared_path().display().to_string(),
        version,
    })
}

use cf_tunnel_core::local_server;

#[tauri::command]
pub fn detect_folder(path: String) -> AppResult<local_server::detect::Detected> {
    Ok(local_server::detect(std::path::Path::new(&path)))
}

#[tauri::command]
pub fn write_setup_guide(path: String) -> AppResult<String> {
    let p = local_server::setup_guide::write_setup_guide(std::path::Path::new(&path))?;
    Ok(p.display().to_string())
}

#[tauri::command]
pub fn get_local_logs(state: State<AppState>, page_id: i64, last_n: usize)
    -> AppResult<Vec<cf_tunnel_core::supervisor::log_buffer::LogLine>>
{
    Ok(state.local.logs(page_id, last_n))
}

#[tauri::command]
pub fn local_is_running(state: State<AppState>, page_id: i64) -> AppResult<bool> {
    Ok(state.local.is_running(page_id))
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<Settings> {
    let g = state.db.lock();
    queries::get_settings(&g)
}

#[tauri::command]
pub fn set_settings(state: State<AppState>, patch: SettingsPatch) -> AppResult<Settings> {
    let g = state.db.lock();
    let next = queries::set_settings(&g, &patch)?;
    if patch.cloudflared_path.is_some() {
        let path = next.cloudflared_path
            .clone()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| CloudflaredCli::discover()
                .map(|c| c.path)
                .unwrap_or_else(|_| std::path::PathBuf::from("cloudflared")));
        state.supervisor.set_cloudflared_path(path);
    }
    Ok(next)
}

#[tauri::command]
pub async fn start_or_restart_for_page(state: State<'_, AppState>, page_id: i64) -> AppResult<()> {
    start_or_restart_for_page_inner(state.inner(), page_id).await
}

/// API-driven start/restart flow. Pushes the page's ingress to CF via
/// PUT /cfd_tunnel/{id}/configurations, fetches the run token, and spawns
/// `cloudflared tunnel run --token=…`. No yaml on disk, no cert.pem, no
/// credentials.json — works locally AND on the remote connector.
pub async fn start_or_restart_for_page_inner(
    state: &AppState,
    page_id: i64,
) -> AppResult<()> {
    let (tunnel_uuid, this_page) = {
        let g = state.db.lock();
        let page = queries::get_page(&g, page_id)?;
        (page.tunnel_uuid.clone(), page)
    };

    // 1. Local server lifecycle (folder-deploy pages).
    if this_page.enabled {
        if let (Some(dir), Some(cmd)) = (this_page.source_dir.as_ref(), this_page.run_command.as_ref()) {
            let port = match this_page.assigned_port {
                Some(p) => p,
                None    => state.local.alloc_port()?,
            };
            state.local.stop(page_id);
            let dir_path = std::path::Path::new(dir);
            let port = if cmd == cf_tunnel_core::local_server::EMBEDDED_STATIC {
                state.local.start_static(page_id, dir_path, port).await?
            } else {
                state.local.start_external(page_id, dir_path, cmd, port)?
            };
            let url = format!("http://localhost:{port}");
            let g = state.db.lock();
            queries::update_page(&g, page_id, &PagePatch {
                service_url: Some(url),
                assigned_port: Some(Some(port)),
                ..Default::default()
            })?;
        }
    } else {
        state.local.stop(page_id);
    }

    // 2. Collect every enabled sibling for this tunnel into ingress rules.
    let enabled_siblings: Vec<Page> = {
        let g = state.db.lock();
        queries::list_pages(&g)?
            .into_iter()
            .filter(|p| p.tunnel_uuid == tunnel_uuid && p.enabled)
            .collect()
    };

    if enabled_siblings.is_empty() {
        state.supervisor.stop(&tunnel_uuid);
        return Ok(());
    }

    let ingress: Vec<cf_tunnel_core::cloudflared::api::IngressRule> = enabled_siblings
        .iter()
        .map(|p| cf_tunnel_core::cloudflared::api::IngressRule {
            hostname: Some(p.hostname.clone()),
            service: p.service_url.clone(),
            path: None,
        })
        // Cloudflare requires a catch-all `service: http_status:404` at the end.
        .chain(std::iter::once(cf_tunnel_core::cloudflared::api::IngressRule {
            hostname: None,
            service: "http_status:404".into(),
            path: None,
        }))
        .collect();

    // 3. Push ingress + fetch run token via API. Both work in local and
    //    remote modes — only the keyring's API token is required.
    let creds = cf_tunnel_core::cloudflared::api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::api::put_tunnel_config(&creds, &tunnel_uuid, ingress).await?;
    let token = cf_tunnel_core::cloudflared::api::get_tunnel_token(&creds, &tunnel_uuid).await?;

    state.supervisor.restart_with_token(&tunnel_uuid, &token)?;
    Ok(())
}

// --- Cloudflare API token + zones -------------------------------------------

use cf_tunnel_core::secrets;
use cf_tunnel_core::cloudflared::api;

#[tauri::command]
pub async fn set_api_token(token: String) -> AppResult<()> {
    api::verify_token(&token).await?;
    secrets::set(secrets::CF_API_TOKEN, &token)
        .map_err(|e| cf_tunnel_core::error::AppError::Other { message: format!("keyring write: {e}") })?;
    match secrets::get(secrets::CF_API_TOKEN) {
        Some(stored) if stored == token => Ok(()),
        Some(_) => Err(cf_tunnel_core::error::AppError::Other {
            message: "keyring read-back returned a different value than was written".into(),
        }),
        None => Err(cf_tunnel_core::error::AppError::Other {
            message: "keyring write succeeded but read-back returned nothing — credential did not persist. Check Windows Credential Manager access.".into(),
        }),
    }
}

#[tauri::command]
pub fn clear_api_token() -> AppResult<()> {
    let _ = secrets::delete(secrets::CF_API_TOKEN);
    Ok(())
}

#[tauri::command]
pub fn has_api_token() -> AppResult<bool> {
    Ok(secrets::has(secrets::CF_API_TOKEN))
}

#[tauri::command]
pub fn get_api_token() -> AppResult<Option<String>> {
    Ok(secrets::get(secrets::CF_API_TOKEN))
}

#[tauri::command]
pub async fn verify_api_token() -> AppResult<()> {
    let Some(token) = secrets::get(secrets::CF_API_TOKEN) else {
        return Err(cf_tunnel_core::error::AppError::Other { message: "no token saved".into() });
    };
    api::verify_token(&token).await
}

#[tauri::command]
pub async fn list_zones() -> AppResult<Vec<api::Zone>> {
    let creds = api::resolve_credentials()?;
    api::list_zones(&creds).await
}

// --- Global API Key (legacy auth) ------------------------------------------

#[tauri::command]
pub async fn set_global_key(email: String, key: String) -> AppResult<()> {
    let creds = api::Credentials::GlobalKey { email: email.clone(), key: key.clone() };
    api::verify(&creds).await?;
    secrets::set(secrets::CF_GLOBAL_EMAIL, &email)
        .map_err(|e| cf_tunnel_core::error::AppError::Other { message: format!("keyring write (email): {e}") })?;
    secrets::set(secrets::CF_GLOBAL_KEY, &key)
        .map_err(|e| cf_tunnel_core::error::AppError::Other { message: format!("keyring write (key): {e}") })?;
    match (secrets::get(secrets::CF_GLOBAL_EMAIL), secrets::get(secrets::CF_GLOBAL_KEY)) {
        (Some(e), Some(k)) if e == email && k == key => Ok(()),
        _ => Err(cf_tunnel_core::error::AppError::Other {
            message: "keyring read-back failed for global key — credential did not persist.".into(),
        }),
    }
}

#[tauri::command]
pub fn clear_global_key() -> AppResult<()> {
    let _ = secrets::delete(secrets::CF_GLOBAL_EMAIL);
    let _ = secrets::delete(secrets::CF_GLOBAL_KEY);
    Ok(())
}

#[tauri::command]
pub fn has_global_key() -> AppResult<bool> {
    Ok(secrets::has(secrets::CF_GLOBAL_EMAIL) && secrets::has(secrets::CF_GLOBAL_KEY))
}

#[tauri::command]
pub fn get_global_key() -> AppResult<Option<(String, String)>> {
    match (secrets::get(secrets::CF_GLOBAL_EMAIL), secrets::get(secrets::CF_GLOBAL_KEY)) {
        (Some(e), Some(k)) => Ok(Some((e, k))),
        _ => Ok(None),
    }
}

// ── Workers ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_workers() -> AppResult<Vec<cf_tunnel_core::cloudflared::workers::Worker>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::workers::list_workers(&creds).await
}

#[tauri::command]
pub async fn get_worker(id: String) -> AppResult<cf_tunnel_core::cloudflared::workers::WorkerScript> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::workers::get_worker(&creds, &id).await
}

#[tauri::command]
pub async fn delete_worker(id: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::workers::delete_worker(&creds, &id).await
}

#[tauri::command]
pub async fn list_worker_secrets(id: String) -> AppResult<Vec<cf_tunnel_core::cloudflared::workers::WorkerSecret>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::workers::list_secrets(&creds, &id).await
}

#[tauri::command]
pub async fn put_worker_secret(id: String, name: String, value: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::workers::put_secret(&creds, &id, &name, &value).await
}

#[tauri::command]
pub async fn delete_worker_secret(id: String, name: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::workers::delete_secret(&creds, &id, &name).await
}

// ── R2 buckets ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_r2_buckets() -> AppResult<Vec<cf_tunnel_core::cloudflared::r2::R2Bucket>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::r2::list_buckets(&creds).await
}

#[tauri::command]
pub async fn create_r2_bucket(name: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::r2::create_bucket(&creds, &name).await
}

#[tauri::command]
pub async fn delete_r2_bucket(name: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::r2::delete_bucket(&creds, &name).await
}

// ── Live tail (project-scoped, via wrangler tail) ────────────────────────

use std::collections::HashMap;
use std::sync::OnceLock;

fn tails() -> &'static parking_lot::Mutex<HashMap<String, tokio::process::Child>> {
    static TAILS: OnceLock<parking_lot::Mutex<HashMap<String, tokio::process::Child>>> = OnceLock::new();
    TAILS.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn start_project_tail(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> AppResult<String> {
    let project = {
        let g = state.db.lock();
        cf_tunnel_core::projects::store::by_id(&g, project_id)?
    };
    let folder = std::path::PathBuf::from(&project.folder);
    let wrangler = cf_tunnel_core::wrangler::locate_wrangler(&folder)?;

    let tail_id = format!("tail-{}-{}", project_id, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let channel = format!("worker-tail://{}/event", tail_id);

    let mut cmd = tokio::process::Command::new(&wrangler);
    cmd.args(["tail", project.name.as_str(), "--format=json"])
        .current_dir(&folder)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    for (k, v) in cf_tunnel_core::wrangler::cf_env_vars() {
        cmd.env(k, v);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other { message: format!("spawn wrangler tail: {e}") })?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    tails().lock().insert(tail_id.clone(), child);

    use tokio::io::{AsyncBufReadExt, BufReader};
    let app_for_stdout = app.clone();
    let chan_for_stdout = channel.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let payload = serde_json::from_str::<serde_json::Value>(&line)
                .unwrap_or_else(|_| serde_json::json!({"raw": line}));
            let _ = app_for_stdout.emit(&chan_for_stdout, payload);
        }
    });
    let app_for_stderr = app.clone();
    let chan_for_stderr = channel.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_for_stderr.emit(&chan_for_stderr, serde_json::json!({"info": line}));
        }
    });

    Ok(tail_id)
}

#[tauri::command]
pub async fn stop_project_tail(tail_id: String) -> AppResult<()> {
    if let Some(mut child) = tails().lock().remove(&tail_id) {
        let _ = child.start_kill();
    }
    Ok(())
}

// ── Project file editor ──────────────────────────────────────────────────

#[tauri::command]
pub fn list_project_files(folder: String) -> AppResult<Vec<String>> {
    cf_tunnel_core::projects::files::list(std::path::Path::new(&folder))
}

#[tauri::command]
pub fn read_project_file(folder: String, rel: String) -> AppResult<String> {
    cf_tunnel_core::projects::files::read(std::path::Path::new(&folder), &rel)
}

#[tauri::command]
pub fn write_project_file(folder: String, rel: String, content: String) -> AppResult<()> {
    cf_tunnel_core::projects::files::write(std::path::Path::new(&folder), &rel, &content)
}

// ── D1 ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_d1_databases() -> AppResult<Vec<cf_tunnel_core::cloudflared::d1::D1Database>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::d1::list_databases(&creds).await
}

#[tauri::command]
pub async fn exec_d1(uuid: String, sql: String) -> AppResult<cf_tunnel_core::cloudflared::d1::D1QueryResult> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::d1::exec_sql(&creds, &uuid, &sql).await
}

#[tauri::command]
pub async fn delete_d1_database(uuid: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::d1::delete_database(&creds, &uuid).await
}

// ── Zone cache controls ────────────────────────────────────────────────────

#[tauri::command]
pub async fn purge_cache(zone_id: String, files: Vec<String>) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::api::purge_cache(&creds, &zone_id, &files).await
}

#[tauri::command]
pub async fn set_dev_mode(zone_id: String, on: bool) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::api::set_development_mode(&creds, &zone_id, on).await
}

#[tauri::command]
pub async fn get_dev_mode(zone_id: String) -> AppResult<cf_tunnel_core::cloudflared::api::DevModeStatus> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::api::get_development_mode(&creds, &zone_id).await
}

// ── DNS records (general CRUD; tunnel-CNAME flow stays in api.rs) ─────────

#[tauri::command]
pub async fn list_dns_records(zone_id: String) -> AppResult<Vec<cf_tunnel_core::cloudflared::dns::DnsRecord>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::dns::list_records(&creds, &zone_id).await
}

#[tauri::command]
pub async fn create_dns_record(
    zone_id: String,
    record: cf_tunnel_core::cloudflared::dns::NewDnsRecord,
) -> AppResult<cf_tunnel_core::cloudflared::dns::DnsRecord> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::dns::create_record(&creds, &zone_id, &record).await
}

#[tauri::command]
pub async fn delete_dns_record(zone_id: String, record_id: String) -> AppResult<()> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::dns::delete_record(&creds, &zone_id, &record_id).await
}

// ── Cloudflare Pages ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_pages_projects() -> AppResult<Vec<cf_tunnel_core::cloudflared::pages::PagesProject>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::pages::list_projects(&creds).await
}

#[tauri::command]
pub async fn list_pages_deployments(project: String) -> AppResult<Vec<cf_tunnel_core::cloudflared::pages::PagesDeployment>> {
    let creds = api::resolve_credentials()?;
    cf_tunnel_core::cloudflared::pages::list_deployments(&creds, &project).await
}

// ── Project wizard ──────────────────────────────────────────────────────

#[tauri::command]
pub fn list_templates() -> AppResult<Vec<cf_tunnel_core::scaffold::Template>> {
    Ok(cf_tunnel_core::scaffold::all())
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> AppResult<Vec<cf_tunnel_core::projects::store::Project>> {
    let g = state.db.lock();
    cf_tunnel_core::projects::store::list(&g)
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: i64) -> AppResult<()> {
    let g = state.db.lock();
    cf_tunnel_core::projects::store::delete(&g, id)
}

#[tauri::command]
pub fn update_project_live_url(
    state: State<AppState>,
    id: i64,
    deployed_url: Option<String>,
    custom_domain: Option<String>,
) -> AppResult<cf_tunnel_core::projects::store::Project> {
    let g = state.db.lock();
    cf_tunnel_core::projects::store::update_live_url(
        &g,
        id,
        deployed_url.as_deref(),
        custom_domain.as_deref(),
    )
}

#[tauri::command]
pub async fn stop_project(state: State<'_, AppState>, id: i64) -> AppResult<cf_tunnel_core::projects::store::Project> {
    cf_tunnel_core::projects::stop::run(state.db.clone(), id).await
}

#[tauri::command]
pub async fn start_create_project(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: cf_tunnel_core::projects::create::CreateSpec,
) -> AppResult<String> {
    let id = format!("{}-{}", spec.name, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let id_for_task = id.clone();
    let db = state.db.clone();
    let app_for_task = app.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let channel = format!("project-create://{}/progress", id_for_task);

        let pump_app = app_for_task.clone();
        let pump_channel = channel.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                let _ = pump_app.emit(&pump_channel, evt);
            }
        });

        let outcome = cf_tunnel_core::projects::create::run(spec.clone(), tx).await;
        let _ = pump.await;

        if let Ok(out) = outcome {
            let g = db.lock();
            let _ = cf_tunnel_core::projects::store::insert(
                &g,
                &spec.name,
                &spec.template_id,
                &out.folder.to_string_lossy(),
                out.url.as_deref(),
                spec.custom_domain.as_deref(),
            );
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn redeploy_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<String> {
    let event_id = format!("redeploy-{}-{}", id, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let event_id_for_task = event_id.clone();
    let db = state.db.clone();
    let app_for_task = app.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let channel = format!("project-create://{}/progress", event_id_for_task);
        let pump_app = app_for_task.clone();
        let pump_channel = channel.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                let _ = pump_app.emit(&pump_channel, evt);
            }
        });
        let result = cf_tunnel_core::projects::redeploy::run(db, id, tx).await;
        let _ = pump.await;
        if let Err(e) = result {
            // The Error event was emitted from inside redeploy::run, but we'd
            // never see it if locating wrangler failed before the first step.
            let _ = app_for_task.emit(&channel, cf_tunnel_core::projects::create::ProgressEvent::Error {
                step: cf_tunnel_core::projects::create::Step::Deploy,
                message: e.to_string(),
            });
        }
    });

    Ok(event_id)
}

// ── Setup detector + auto-install ────────────────────────────────────────

#[tauri::command]
pub fn detect_setup() -> AppResult<Vec<cf_tunnel_core::setup::ToolStatus>> {
    Ok(cf_tunnel_core::setup::detect_all())
}

#[tauri::command]
pub async fn install_tool(app: AppHandle, tool_id: String) -> AppResult<String> {
    let event_id = format!("install-{}-{}", tool_id, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let event_id_for_task = event_id.clone();
    let app_for_task = app.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let channel = format!("project-create://{}/progress", event_id_for_task);
        let pump_app = app_for_task.clone();
        let pump_channel = channel.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                let _ = pump_app.emit(&pump_channel, evt);
            }
        });
        let _ = cf_tunnel_core::setup::install::run(tool_id, tx).await;
        let _ = pump.await;
    });

    Ok(event_id)
}

#[tauri::command]
pub fn list_missing_tools() -> AppResult<Vec<cf_tunnel_core::setup::ToolStatus>> {
    Ok(cf_tunnel_core::setup::install::missing_required())
}

#[tauri::command]
pub async fn install_all_tools(app: AppHandle) -> AppResult<String> {
    let event_id = format!("install-all-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let event_id_for_task = event_id.clone();
    let app_for_task = app.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let channel = format!("project-create://{}/progress", event_id_for_task);
        let pump_app = app_for_task.clone();
        let pump_channel = channel.clone();
        let pump = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                let _ = pump_app.emit(&pump_channel, evt);
            }
        });
        let _ = cf_tunnel_core::setup::install::run_all(tx).await;
        let _ = pump.await;
    });

    Ok(event_id)
}

// ── Import existing project ──────────────────────────────────────────────

#[tauri::command]
pub fn scan_wrangler_projects(folder: String) -> AppResult<Vec<cf_tunnel_core::projects::inspect::FolderInspection>> {
    cf_tunnel_core::projects::inspect::scan_wrangler_projects(std::path::Path::new(&folder))
}

#[tauri::command]
pub fn inspect_project_folder(folder: String) -> AppResult<cf_tunnel_core::projects::inspect::FolderInspection> {
    cf_tunnel_core::projects::inspect::inspect(std::path::Path::new(&folder))
}

#[tauri::command]
pub fn import_project(
    state: State<AppState>,
    spec: cf_tunnel_core::projects::import::ImportSpec,
) -> AppResult<cf_tunnel_core::projects::store::Project> {
    cf_tunnel_core::projects::import::run(state.db.clone(), spec)
}

#[tauri::command]
pub async fn pick_project_folder(app: AppHandle) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |result| {
        let _ = tx.send(result.and_then(|p| p.into_path().ok().map(|pb| pb.to_string_lossy().to_string())));
    });
    Ok(rx.await.unwrap_or(None))
}

// ── HTTP request tester ────────────────────────────────────────────────────

#[tauri::command]
pub async fn ping_url(url: String) -> AppResult<cf_tunnel_core::http_tester::PingResult> {
    cf_tunnel_core::http_tester::ping_url(&url).await
}

#[tauri::command]
pub async fn http_request(spec: cf_tunnel_core::http_tester::HttpRequestSpec) -> AppResult<cf_tunnel_core::http_tester::HttpResponse> {
    cf_tunnel_core::http_tester::http_request(spec).await
}

// ── Native shell ops ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_in_editor(path: String) -> AppResult<()> {
    cf_tunnel_core::shell::open_in_editor(&path)
}

#[tauri::command]
pub async fn open_project_folder(path: String) -> AppResult<()> {
    cf_tunnel_core::shell::open_folder(&path)
}

#[tauri::command]
pub async fn delete_project_folder(folder: String) -> AppResult<()> {
    cf_tunnel_core::shell::delete_folder(&folder)
}

// ── Remote-style FS browser (also useful in local mode if invoked) ────────

#[tauri::command]
pub fn browse_fs(path: Option<String>) -> AppResult<cf_tunnel_core::fs_browse::BrowseResult> {
    cf_tunnel_core::fs_browse::browse(path.as_deref())
}

