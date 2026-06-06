//! Project-creation pipeline. Takes a CreateSpec, walks through every step,
//! emits structured progress events the UI can render as a live log.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::error::{AppError, AppResult};
use crate::scaffold::{self, Database, Kind};
use crate::wrangler::{self, CmdLine};

/// User input from the wizard.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpec {
    pub template_id: String,
    pub name: String,
    pub folder: PathBuf,
    /// Optional. If set, attach this hostname as a custom domain after deploy.
    /// Must already be a zone on the user's CF account.
    pub custom_domain: Option<String>,
}

/// One step of the pipeline — used by the UI as a progress label.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Scaffold,
    InstallDeps,
    CreateDatabase,
    MigrateSchema,
    Deploy,
    AttachDomain,
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProgressEvent {
    /// A new step has started. Carries a human label.
    StepStart { step: Step, label: String },
    /// One line of subprocess output (stdout or stderr).
    Line { line: CmdLine },
    /// Step finished successfully.
    StepDone { step: Step },
    /// Whole pipeline succeeded. Carries the live URL + folder path.
    Success { url: Option<String>, folder: String },
    /// Pipeline failed at the given step.
    Error { step: Step, message: String },
}

/// Channel-based event sink so callers can pipe progress to Tauri events,
/// stdout, or wherever. Cheaply cloneable.
pub type EventSink = mpsc::UnboundedSender<ProgressEvent>;

/// Result of the pipeline. We return the final URL + folder so the UI can
/// surface them on the success screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOutcome {
    pub folder: PathBuf,
    pub url: Option<String>,
    pub template_id: String,
}

pub async fn run(spec: CreateSpec, events: EventSink) -> AppResult<CreateOutcome> {
    let template = scaffold::by_id(&spec.template_id)
        .ok_or(AppError::Other { message: format!("unknown template: {}", spec.template_id) })?;

    let project_dir = spec.folder.join(&spec.name);
    if project_dir.exists() {
        return Err(AppError::Other {
            message: format!("folder already exists: {}", project_dir.display()),
        });
    }

    // ── 1. Scaffold ───────────────────────────────────────────────────────
    emit(&events, ProgressEvent::StepStart {
        step: Step::Scaffold,
        label: format!("Writing template files to {}", project_dir.display()),
    });
    let vars = build_vars(&spec, &template);
    template.render_to(&project_dir, &string_keyed(&vars))
        .map_err(|e| { emit_err(&events, Step::Scaffold, &e); e })?;
    emit(&events, ProgressEvent::StepDone { step: Step::Scaffold });

    // ── 2. pnpm install ──────────────────────────────────────────────────
    emit(&events, ProgressEvent::StepStart {
        step: Step::InstallDeps,
        label: "Installing dependencies (pnpm install)…".into(),
    });
    let pnpm = wrangler::locate_pnpm()
        .map_err(|e| { emit_err(&events, Step::InstallDeps, &e); e })?;
    run_streaming_through_sink(&pnpm, &["install"], &project_dir, &events).await
        .map_err(|e| { emit_err(&events, Step::InstallDeps, &e); e })?;
    emit(&events, ProgressEvent::StepDone { step: Step::InstallDeps });

    // ── 3. D1 create (if template needs it) ──────────────────────────────
    if template.database == Database::D1 {
        emit(&events, ProgressEvent::StepStart {
            step: Step::CreateDatabase,
            label: format!("Creating D1 database '{}'…", spec.name),
        });
        let wrangler_bin = wrangler::locate_wrangler(&project_dir)
            .map_err(|e| { emit_err(&events, Step::CreateDatabase, &e); e })?;
        let output = wrangler::run_capture(&wrangler_bin, &["d1", "create", &spec.name], &project_dir, &[]).await
            .map_err(|e| { emit_err(&events, Step::CreateDatabase, &e); e })?;

        emit(&events, ProgressEvent::Line { line: CmdLine::Stdout { text: output.clone() } });

        let db_id = parse_database_id(&output).ok_or_else(|| {
            let e = AppError::Other { message: format!("couldn't parse database_id from wrangler output:\n{output}") };
            emit_err(&events, Step::CreateDatabase, &e);
            e
        })?;
        write_database_id(&project_dir, &db_id)
            .map_err(|e| { emit_err(&events, Step::CreateDatabase, &e); e })?;
        emit(&events, ProgressEvent::Line { line: CmdLine::Stdout {
            text: format!("Wrote database_id={db_id} into wrangler.toml"),
        }});
        emit(&events, ProgressEvent::StepDone { step: Step::CreateDatabase });

        // ── 4. Schema migrate ───────────────────────────────────────────
        emit(&events, ProgressEvent::StepStart {
            step: Step::MigrateSchema,
            label: "Running schema.sql against the new database…".into(),
        });
        run_streaming_through_sink(
            &wrangler_bin,
            &["d1", "execute", &spec.name, "--remote", "--file=schema.sql", "-y"],
            &project_dir,
            &events,
        ).await.map_err(|e| { emit_err(&events, Step::MigrateSchema, &e); e })?;
        emit(&events, ProgressEvent::StepDone { step: Step::MigrateSchema });
    }

    // ── 5. Deploy ───────────────────────────────────────────────────────
    emit(&events, ProgressEvent::StepStart {
        step: Step::Deploy,
        label: "Deploying to Cloudflare…".into(),
    });
    let wrangler_bin = wrangler::locate_wrangler(&project_dir)
        .map_err(|e| { emit_err(&events, Step::Deploy, &e); e })?;
    let deploy_args: Vec<&str> = match template.kind {
        Kind::Worker => vec!["deploy"],
        Kind::Pages => vec!["pages", "deploy", "public", "--project-name", spec.name.as_str()],
    };
    // Capture so we can pull the live URL out of the final line.
    let deploy_out = run_capture_and_forward(&wrangler_bin, &deploy_args, &project_dir, &events).await
        .map_err(|e| { emit_err(&events, Step::Deploy, &e); e })?;
    let url = parse_deploy_url(&deploy_out);
    emit(&events, ProgressEvent::StepDone { step: Step::Deploy });

    // ── 6. Optional custom domain ──────────────────────────────────────
    if let Some(domain) = spec.custom_domain.as_ref().filter(|d| !d.trim().is_empty()) {
        emit(&events, ProgressEvent::StepStart {
            step: Step::AttachDomain,
            label: format!("Attaching custom domain {domain}…"),
        });
        match template.kind {
            Kind::Worker => attach_worker_domain(&spec.name, domain).await,
            Kind::Pages  => attach_pages_domain(&spec.name, domain).await,
        }.map_err(|e| { emit_err(&events, Step::AttachDomain, &e); e })?;
        emit(&events, ProgressEvent::StepDone { step: Step::AttachDomain });
    }

    // ── Done ────────────────────────────────────────────────────────────
    let final_url = spec.custom_domain.clone().map(|d| format!("https://{d}")).or(url);
    emit(&events, ProgressEvent::Success {
        url: final_url.clone(),
        folder: project_dir.to_string_lossy().to_string(),
    });

    Ok(CreateOutcome { folder: project_dir, url: final_url, template_id: spec.template_id })
}

// ── helpers ────────────────────────────────────────────────────────────

fn build_vars(spec: &CreateSpec, _t: &scaffold::Template) -> HashMap<String, String> {
    let mut h = HashMap::new();
    h.insert("project_name".into(), spec.name.clone());
    // D1 binding defaults to project name with non-alphanumerics → "_" so it's
    // a valid JS identifier inside the Worker (env.<binding>).
    let binding = sanitize_identifier(&spec.name);
    h.insert("d1_binding".into(), binding);
    h.insert("d1_name".into(), spec.name.clone());
    // workers_dev: if the user gave a custom domain, the *.workers.dev URL
    // is redundant — disable it so the project only has one canonical URL.
    // No custom domain → keep workers_dev = true so the user has *some* URL.
    let has_domain = spec.custom_domain.as_ref().map(|d| !d.trim().is_empty()).unwrap_or(false);
    h.insert("workers_dev".into(), if has_domain { "false".into() } else { "true".into() });
    h
}

fn string_keyed<'a>(m: &'a HashMap<String, String>) -> HashMap<&'a str, String> {
    m.iter().map(|(k, v)| (k.as_str(), v.clone())).collect()
}

fn sanitize_identifier(s: &str) -> String {
    let mut out: String = s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if out.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        out.insert(0, '_');
    }
    if out.is_empty() { out.push('_'); }
    out
}

/// Parse `database_id = "..."` out of the TOML snippet wrangler prints after
/// `d1 create`. We don't bother with a full TOML parser — the line is stable.
fn parse_database_id(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("database_id") {
            let after_eq = rest.split('=').nth(1)?.trim();
            return Some(after_eq.trim_matches('"').to_string());
        }
    }
    None
}

/// Pull the live URL out of wrangler's deploy output. Format varies between
/// Workers ("Deployed <name> triggers\n  https://...") and Pages ("Deployment
/// complete! Take a peek over at https://...").
fn parse_deploy_url(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(i) = trimmed.find("https://") {
            let candidate = &trimmed[i..];
            let end = candidate.find(char::is_whitespace).unwrap_or(candidate.len());
            return Some(candidate[..end].trim_end_matches([',', '.', ';']).to_string());
        }
    }
    None
}

fn write_database_id(project_dir: &std::path::Path, db_id: &str) -> AppResult<()> {
    let path = project_dir.join("wrangler.toml");
    let body = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Other { message: format!("read wrangler.toml: {e}") })?;
    let patched = body.replace("database_id = \"\"", &format!("database_id = \"{db_id}\""));
    std::fs::write(&path, patched)
        .map_err(|e| AppError::Other { message: format!("write wrangler.toml: {e}") })?;
    Ok(())
}

pub async fn attach_worker_domain(worker_name: &str, hostname: &str) -> AppResult<()> {
    use crate::cloudflared::api::{resolve_credentials, http_client, CF_API_BASE, account_id};
    let creds = resolve_credentials()?;
    let acct = account_id(&creds).await?;
    let zone = zone_id_for_hostname(&creds, hostname).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/workers/domains");
    let body = serde_json::json!({
        "zone_id": zone,
        "hostname": hostname,
        "service": worker_name,
        "environment": "production",
    });
    let resp = creds.apply(client.put(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("attach domain: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("attach domain HTTP {status}: {txt}") });
    }
    Ok(())
}

pub async fn attach_pages_domain(project_name: &str, hostname: &str) -> AppResult<()> {
    use crate::cloudflared::api::{resolve_credentials, http_client, CF_API_BASE, account_id};
    let creds = resolve_credentials()?;
    let acct = account_id(&creds).await?;
    let client = http_client()?;
    let url = format!("{CF_API_BASE}/accounts/{acct}/pages/projects/{project_name}/domains");
    let body = serde_json::json!({ "name": hostname });
    let resp = creds.apply(client.post(&url).json(&body)).send().await
        .map_err(|e| AppError::Other { message: format!("attach pages domain: {e}") })?;
    let status = resp.status();
    let txt = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Other { message: format!("attach pages domain HTTP {status}: {txt}") });
    }
    Ok(())
}

/// Find the CF zone id whose name is a suffix of `hostname`. Picks the
/// longest match so `app.api.example.com` resolves to `example.com` over
/// `api.example.com` if both happen to be zones (rare but possible).
async fn zone_id_for_hostname(
    creds: &crate::cloudflared::api::Credentials, hostname: &str,
) -> AppResult<String> {
    let zones = crate::cloudflared::api::list_zones(creds).await?;
    let host_l = hostname.to_lowercase();
    let best = zones.iter()
        .filter(|z| host_l.ends_with(&z.name.to_lowercase()))
        .max_by_key(|z| z.name.len());
    best.map(|z| z.id.clone()).ok_or(AppError::Other {
        message: format!("no zone in your account matches {hostname}. Add the domain to Cloudflare first."),
    })
}

fn emit(sink: &EventSink, e: ProgressEvent) { let _ = sink.send(e); }

fn emit_err(sink: &EventSink, step: Step, e: &AppError) {
    let _ = sink.send(ProgressEvent::Error { step, message: e.to_string() });
}

async fn run_streaming_through_sink(
    program: &std::path::Path,
    args: &[&str],
    cwd: &std::path::Path,
    events: &EventSink,
) -> AppResult<()> {
    let sink = events.clone();
    wrangler::run_streaming(program, args, cwd, &[], move |line| {
        let _ = sink.send(ProgressEvent::Line { line });
    }).await
}

/// Like run_streaming but also returns the captured stdout/stderr so we can
/// scrape values out of it (like the deploy URL).
async fn run_capture_and_forward(
    program: &std::path::Path,
    args: &[&str],
    cwd: &std::path::Path,
    events: &EventSink,
) -> AppResult<String> {
    let buf = Arc::new(parking_lot::Mutex::new(String::new()));
    let sink = events.clone();
    let buf2 = buf.clone();
    wrangler::run_streaming(program, args, cwd, &[], move |line| {
        match &line {
            CmdLine::Stdout { text } => { buf2.lock().push_str(text); buf2.lock().push('\n'); }
            CmdLine::Stderr { text } => { buf2.lock().push_str(text); buf2.lock().push('\n'); }
        }
        let _ = sink.send(ProgressEvent::Line { line });
    }).await?;
    let out = buf.lock().clone();
    Ok(out)
}
