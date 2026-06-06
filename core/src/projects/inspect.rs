//! Inspect a folder to see if it holds a wrangler.toml project, and scan a
//! tree for all such folders. Shared between Tauri and the connector so the
//! Import flow works identically in local and remote modes.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInspection {
    pub valid: bool,
    pub reason: Option<String>,
    pub folder: String,
    pub name: Option<String>,
    pub kind: String,
    pub has_d1: bool,
    pub has_r2: bool,
    pub template_guess: String,
    pub current_deployed_url: Option<String>,
}

const WALK_SKIP: &[&str] = &[
    "node_modules", ".git", "target", "dist", ".next", ".turbo", ".wrangler",
    ".svelte-kit", ".cache", "build", "out",
];

pub fn scan_wrangler_projects(root: &Path) -> AppResult<Vec<FolderInspection>> {
    if !root.exists() {
        return Err(AppError::Other {
            message: format!("folder doesn't exist: {}", root.display()),
        });
    }
    let mut hits: Vec<PathBuf> = Vec::new();
    walk(root, &mut hits, 0)?;
    let mut out = Vec::new();
    for project_dir in hits {
        out.push(inspect(&project_dir)?);
    }
    Ok(out)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) -> AppResult<()> {
    if depth > 5 {
        return Ok(());
    }
    let toml = dir.join("wrangler.toml");
    if toml.exists() {
        out.push(dir.to_path_buf());
        return Ok(());
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if WALK_SKIP.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let p = entry.path();
        if p.is_dir() {
            let _ = walk(&p, out, depth + 1);
        }
    }
    Ok(())
}

pub fn inspect(folder: &Path) -> AppResult<FolderInspection> {
    let folder_str = folder.to_string_lossy().to_string();
    let toml_path = folder.join("wrangler.toml");
    if !toml_path.exists() {
        return Ok(FolderInspection {
            valid: false,
            reason: Some(
                "No wrangler.toml in this folder. Pick a Cloudflare Worker / Pages project.".into(),
            ),
            folder: folder_str,
            name: None,
            kind: "worker".into(),
            has_d1: false,
            has_r2: false,
            template_guess: "empty-worker".into(),
            current_deployed_url: None,
        });
    }
    let toml_body = std::fs::read_to_string(&toml_path).map_err(|e| AppError::Other {
        message: format!("read wrangler.toml: {e}"),
    })?;

    let name = scan_toml_string(&toml_body, "name");
    let has_d1 = toml_body.contains("[[d1_databases]]");
    let has_r2 = toml_body.contains("[[r2_buckets]]");

    let mut is_pages = toml_body.contains("pages_build_output_dir");
    let pkg_path = folder.join("package.json");
    if !is_pages && pkg_path.exists() {
        if let Ok(pkg) = std::fs::read_to_string(&pkg_path) {
            if pkg.contains("wrangler pages deploy") {
                is_pages = true;
            }
        }
    }

    let kind = if is_pages { "pages" } else { "worker" };
    let template_guess = if is_pages {
        "static-pages"
    } else if has_r2 {
        "image-upload-r2"
    } else if has_d1 {
        "api-d1"
    } else {
        "empty-worker"
    }
    .to_string();

    let current_deployed_url = scan_first_route(&toml_body).map(|host| {
        if host.starts_with("http") {
            host
        } else {
            format!("https://{host}")
        }
    });

    Ok(FolderInspection {
        valid: name.is_some(),
        reason: if name.is_none() {
            Some("wrangler.toml is missing the `name` field.".into())
        } else {
            None
        },
        folder: folder_str,
        name,
        kind: kind.into(),
        has_d1,
        has_r2,
        template_guess,
        current_deployed_url,
    })
}

fn scan_toml_string(body: &str, key: &str) -> Option<String> {
    for raw in body.lines() {
        let line = raw.trim();
        if line.starts_with('[') || line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start();
            if !rest.starts_with('=') {
                continue;
            }
            let v = rest[1..].trim().trim_matches('"').trim_matches('\'');
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn scan_first_route(body: &str) -> Option<String> {
    for line in body.lines() {
        let t = line.trim();
        if t.starts_with("pattern") || t.starts_with("routes") {
            if let Some(start) = t.find('"') {
                if let Some(end) = t[start + 1..].find('"') {
                    let raw = &t[start + 1..start + 1 + end];
                    let cleaned = raw.trim_start_matches("*.").split('/').next().unwrap_or(raw);
                    if cleaned.contains('.') {
                        return Some(cleaned.to_string());
                    }
                }
            }
        }
    }
    None
}
