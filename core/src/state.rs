use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use rusqlite::Connection;
use crate::supervisor::Supervisor;
use crate::local_server::LocalSupervisor;
use crate::error::AppResult;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub supervisor: Arc<Supervisor>,
    pub local: Arc<LocalSupervisor>,
    pub configs_dir: PathBuf,
    pub app_data_dir: PathBuf,
}

impl AppState {
    pub fn init(app_data_dir: PathBuf, cloudflared_path: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        let configs_dir = app_data_dir.join("configs");
        std::fs::create_dir_all(&configs_dir)?;
        let conn = crate::db::open_and_migrate(&app_data_dir.join("state.db"))?;
        let effective_cloudflared_path = crate::db::queries::get_settings(&conn)?
            .cloudflared_path
            .map(PathBuf::from)
            .unwrap_or(cloudflared_path);
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            supervisor: Supervisor::new(effective_cloudflared_path),
            local: LocalSupervisor::new(),
            configs_dir,
            app_data_dir,
        })
    }
}
