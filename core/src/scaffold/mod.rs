//! Project scaffolding — built-in templates rendered to disk with simple
//! `{{var}}` substitution. New templates: add a `Template` constant + register
//! in `all()`.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use crate::error::{AppError, AppResult};

/// What this template produces when deployed. Shapes the wizard UI: e.g.
/// `Worker` templates show the "API + D1" pipeline, `Pages` templates run a
/// different create flow.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Worker,
    Pages,
}

/// Whether the template provisions a D1 database during creation. Adds a
/// `wrangler d1 create` step + writes the resulting id into `wrangler.toml`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Database {
    None,
    D1,
}

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub kind: Kind,
    pub database: Database,
    /// Default name shown in the wizard for the D1 binding (when Database::D1).
    /// Conventionally matches the project name, but users can override.
    #[serde(skip)]
    pub files: &'static [(&'static str, &'static str)],
}

impl Template {
    pub fn render_to(&self, dest: &Path, vars: &HashMap<&str, String>) -> AppResult<()> {
        std::fs::create_dir_all(dest)
            .map_err(|e| AppError::Other { message: format!("mkdir {}: {e}", dest.display()) })?;
        for (rel, body) in self.files {
            let full = dest.join(rel);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Other { message: format!("mkdir {}: {e}", parent.display()) })?;
            }
            let rendered = substitute(body, vars);
            std::fs::write(&full, rendered)
                .map_err(|e| AppError::Other { message: format!("write {}: {e}", full.display()) })?;
        }
        Ok(())
    }
}

fn substitute(body: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = body.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

pub fn all() -> Vec<Template> {
    vec![
        API_D1,
        LOGIN_SERVER,
        EMPTY_WORKER,
        STRIPE_WEBHOOK,
        AUTO_UPDATE,
        FORM_TO_D1,
        IMAGE_UPLOAD_R2,
        STATIC_PAGES,
    ]
}

pub fn by_id(id: &str) -> Option<Template> {
    all().into_iter().find(|t| t.id == id)
}

// ── API + D1 ──────────────────────────────────────────────────────────────
// Hono on Workers + D1 binding. Pattern matches the DataBrick login server
// minus the auth-specific logic, so any small API with a database fits.

const API_D1: Template = Template {
    id: "api-d1",
    label: "API + D1 database",
    description: "A Worker with a SQLite database (D1). One file, ready to extend.",
    kind: Kind::Worker,
    database: Database::D1,
    files: &[
        ("package.json", include_str!("templates/api-d1/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/api-d1/wrangler.toml.tmpl")),
        ("schema.sql", include_str!("templates/api-d1/schema.sql.tmpl")),
        ("src/index.js", include_str!("templates/api-d1/src.index.js.tmpl")),
        ("README.md", include_str!("templates/api-d1/README.md.tmpl")),
    ],
};

// ── Empty Worker ──────────────────────────────────────────────────────────
// No database, no Hono, just `export default { fetch }`. Good for redirects,
// webhooks, gateways, single-purpose endpoints.

const EMPTY_WORKER: Template = Template {
    id: "empty-worker",
    label: "Empty Worker",
    description: "A blank Worker function. Use for webhooks, redirects, proxies, or a starting point.",
    kind: Kind::Worker,
    database: Database::None,
    files: &[
        ("package.json", include_str!("templates/empty-worker/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/empty-worker/wrangler.toml.tmpl")),
        ("src/index.js", include_str!("templates/empty-worker/src.index.js.tmpl")),
        ("README.md", include_str!("templates/empty-worker/README.md.tmpl")),
    ],
};

// ── Login server ──────────────────────────────────────────────────────────
// PBKDF2 + machine-bound tokens, mirrors DataBrick's auth backend.
const LOGIN_SERVER: Template = Template {
    id: "login-server",
    label: "Login server",
    description: "Email + password + machine-bound tokens. The DataBrick login pattern, ready for any app.",
    kind: Kind::Worker,
    database: Database::D1,
    files: &[
        ("package.json", include_str!("templates/login-server/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/login-server/wrangler.toml.tmpl")),
        ("schema.sql", include_str!("templates/login-server/schema.sql.tmpl")),
        ("src/index.js", include_str!("templates/login-server/src.index.js.tmpl")),
        ("README.md", include_str!("templates/login-server/README.md.tmpl")),
    ],
};

// ── Stripe webhook receiver ──────────────────────────────────────────────
// Verifies signatures, dispatches per-event-type handlers. No DB.
const STRIPE_WEBHOOK: Template = Template {
    id: "stripe-webhook",
    label: "Stripe webhook",
    description: "Receives + verifies Stripe webhook events. Wire to checkout / subscription flows.",
    kind: Kind::Worker,
    database: Database::None,
    files: &[
        ("package.json", include_str!("templates/stripe-webhook/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/stripe-webhook/wrangler.toml.tmpl")),
        ("src/index.js", include_str!("templates/stripe-webhook/src.index.js.tmpl")),
        ("README.md", include_str!("templates/stripe-webhook/README.md.tmpl")),
    ],
};

// ── Auto-update server ────────────────────────────────────────────────────
// Serves a version manifest for Tauri / Electron / etc. auto-updaters. No DB.
const AUTO_UPDATE: Template = Template {
    id: "auto-update",
    label: "Auto-update server",
    description: "Version manifest endpoint for desktop apps. Tauri / Electron updaters poll this.",
    kind: Kind::Worker,
    database: Database::None,
    files: &[
        ("package.json", include_str!("templates/auto-update/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/auto-update/wrangler.toml.tmpl")),
        ("src/index.js", include_str!("templates/auto-update/src.index.js.tmpl")),
        ("README.md", include_str!("templates/auto-update/README.md.tmpl")),
    ],
};

// ── Form-to-D1 ───────────────────────────────────────────────────────────
// HTML form / JSON submissions → D1. Catches arbitrary extra fields in JSON meta.
const FORM_TO_D1: Template = Template {
    id: "form-to-d1",
    label: "Form → D1",
    description: "Accept HTML form posts (or JSON), store in a database. Newsletter signups, contact forms, etc.",
    kind: Kind::Worker,
    database: Database::D1,
    files: &[
        ("package.json", include_str!("templates/form-to-d1/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/form-to-d1/wrangler.toml.tmpl")),
        ("schema.sql", include_str!("templates/form-to-d1/schema.sql.tmpl")),
        ("src/index.js", include_str!("templates/form-to-d1/src.index.js.tmpl")),
        ("README.md", include_str!("templates/form-to-d1/README.md.tmpl")),
    ],
};

// ── Image upload to R2 ───────────────────────────────────────────────────
// Multipart / raw image uploads → R2 bucket. List + serve + delete.
const IMAGE_UPLOAD_R2: Template = Template {
    id: "image-upload-r2",
    label: "Image upload (R2)",
    description: "Upload images to Cloudflare's object storage. Multipart or raw body, with size + type limits.",
    kind: Kind::Worker,
    database: Database::None,
    files: &[
        ("package.json", include_str!("templates/image-upload-r2/package.json.tmpl")),
        ("wrangler.toml", include_str!("templates/image-upload-r2/wrangler.toml.tmpl")),
        ("src/index.js", include_str!("templates/image-upload-r2/src.index.js.tmpl")),
        ("README.md", include_str!("templates/image-upload-r2/README.md.tmpl")),
    ],
};

// ── Static site (Pages) ───────────────────────────────────────────────────
// Plain HTML/CSS/JS deployed to Cloudflare Pages. Wrangler handles the
// upload; the project doesn't need a runtime.

const STATIC_PAGES: Template = Template {
    id: "static-pages",
    label: "Static site (Pages)",
    description: "HTML / CSS / JS deployed to Cloudflare Pages. No build step, no framework.",
    kind: Kind::Pages,
    database: Database::None,
    files: &[
        ("package.json", include_str!("templates/static-pages/package.json.tmpl")),
        ("public/index.html", include_str!("templates/static-pages/index.html.tmpl")),
        ("public/style.css", include_str!("templates/static-pages/style.css.tmpl")),
        ("README.md", include_str!("templates/static-pages/README.md.tmpl")),
    ],
};
