//! Redeploy an existing project. Reuses the same EventSink contract as
//! `projects::create` so callers (Tauri / connector) can pipe progress into
//! Tauri events or SSE without knowing the difference.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex as PlMutex;
use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::projects::create::{
    attach_pages_domain, attach_worker_domain, EventSink, ProgressEvent, Step,
};
use crate::projects::store;
use crate::scaffold::{self, Kind};
use crate::wrangler::{self, CmdLine};

pub async fn run(
    db: Arc<PlMutex<Connection>>,
    project_id: i64,
    events: EventSink,
) -> AppResult<Option<String>> {
    let project = {
        let g = db.lock();
        store::by_id(&g, project_id)?
    };
    let folder = PathBuf::from(&project.folder);
    let template = scaffold::by_id(&project.template_id).ok_or_else(|| AppError::Other {
        message: format!("unknown template '{}'", project.template_id),
    })?;

    let _ = events.send(ProgressEvent::StepStart {
        step: Step::Deploy,
        label: "Redeploying…".into(),
    });

    let wrangler_bin = wrangler::locate_wrangler(&folder)?;
    let args: Vec<&str> = match template.kind {
        Kind::Worker => vec!["deploy"],
        Kind::Pages => vec![
            "pages",
            "deploy",
            "public",
            "--project-name",
            project.name.as_str(),
        ],
    };

    let buf = Arc::new(parking_lot::Mutex::new(String::new()));
    let buf2 = buf.clone();
    let tx2 = events.clone();
    wrangler::run_streaming(&wrangler_bin, &args, &folder, &[], move |line| {
        match &line {
            CmdLine::Stdout { text } | CmdLine::Stderr { text } => {
                let mut b = buf2.lock();
                b.push_str(text);
                b.push('\n');
            }
        }
        let _ = tx2.send(ProgressEvent::Line { line });
    })
    .await?;
    let out = buf.lock().clone();
    let url = out.lines().find_map(|l| {
        l.find("https://").map(|i| {
            let rest = &l[i..];
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            rest[..end].trim_end_matches([',', '.', ';']).to_string()
        })
    });

    let _ = events.send(ProgressEvent::StepDone { step: Step::Deploy });

    // Re-attach custom domain if the project had one. After `stop` the Worker
    // was deleted, which destroys the domain binding — wrangler deploy alone
    // does not restore it.
    if let Some(domain) = project
        .custom_domain
        .as_ref()
        .filter(|d| !d.trim().is_empty())
    {
        let _ = events.send(ProgressEvent::StepStart {
            step: Step::AttachDomain,
            label: format!("Re-attaching {domain}…"),
        });
        let result = match template.kind {
            Kind::Worker => attach_worker_domain(&project.name, domain).await,
            Kind::Pages => attach_pages_domain(&project.name, domain).await,
        };
        match result {
            Ok(()) => {
                let _ = events.send(ProgressEvent::StepDone {
                    step: Step::AttachDomain,
                });
            }
            Err(e) => {
                let _ = events.send(ProgressEvent::Line {
                    line: CmdLine::Stderr {
                        text: format!(
                            "Custom domain re-attach failed: {e} — Worker is still up on workers.dev"
                        ),
                    },
                });
            }
        }
    }

    let final_url = project
        .custom_domain
        .as_ref()
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!("https://{d}"))
        .or(url.clone());

    // Touch the DB BEFORE emitting Success so a frontend that refreshes on
    // success reads the fresh row, not a stale one.
    {
        let g = db.lock();
        let _ = store::touch_deploy(&g, project_id, final_url.as_deref());
    }

    let _ = events.send(ProgressEvent::Success {
        url: final_url.clone(),
        folder: folder.to_string_lossy().to_string(),
    });

    Ok(final_url)
}
