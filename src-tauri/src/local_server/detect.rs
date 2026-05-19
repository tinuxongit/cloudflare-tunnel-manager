//! Folder inspection — pick a sensible run command for a given source dir.
//!
//! The output is *advisory*: the user can override `run_command` in the page
//! form. `{PORT}` in the returned command is substituted by the supervisor at
//! spawn time.

use std::path::Path;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectedKind {
    NodeStart,        // package.json with a "start" script — we extract the actual command
    NodeStatic,       // package.json without start — serve via embedded static server
    Python,           // main.py with Flask/Uvicorn-ish hints
    StaticFolder,     // serve via embedded static server
    Empty,            // folder exists but has nothing recognizable
    NotFound,         // path doesn't exist
}

/// Sentinel that signals "the supervisor should run its embedded static-file
/// server for this folder instead of spawning a subprocess".
pub const EMBEDDED_STATIC: &str = "__embedded_static__";

#[derive(Debug, Clone, Serialize)]
pub struct Detected {
    pub kind: DetectedKind,
    pub command: String,           // shell command, with {PORT} placeholder
    pub note: String,              // human-readable summary for the UI
}

pub fn detect(dir: &Path) -> Detected {
    if !dir.exists() {
        return Detected {
            kind: DetectedKind::NotFound,
            command: String::new(),
            note: format!("Path does not exist: {}", dir.display()),
        };
    }

    // Node project?
    let pkg = dir.join("package.json");
    if pkg.exists() {
        if let Ok(text) = std::fs::read_to_string(&pkg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(start) = json.get("scripts")
                    .and_then(|s| s.get("start"))
                    .and_then(|v| v.as_str())
                {
                    // Extract the literal command (e.g. "node server.js") and run it
                    // directly. Avoids the cmd.exe -> npm.cmd -> node wrapper chain
                    // that costs ~120 MB of zombie shells per page.
                    return Detected {
                        kind: DetectedKind::NodeStart,
                        command: start.to_string(),
                        note: format!("Node project — runs `{start}` directly (skips npm wrapper) with PORT={{PORT}}"),
                    };
                }
            }
        }
        return Detected {
            kind: DetectedKind::NodeStatic,
            command: EMBEDDED_STATIC.into(),
            note: "Node project without start script — served by built-in static server".into(),
        };
    }

    // Python project? Detect main.py and a few common framework hints.
    let main_py = dir.join("main.py");
    if main_py.exists() {
        return Detected {
            kind: DetectedKind::Python,
            command: "python main.py".into(),
            note: "Python entry main.py — passes PORT env var".into(),
        };
    }

    // Static — anything with at least an index.html, or fall back to serving the folder.
    let has_index = dir.join("index.html").exists();
    if has_index {
        return Detected {
            kind: DetectedKind::StaticFolder,
            command: EMBEDDED_STATIC.into(),
            note: "Static site (index.html present) — served by built-in static server".into(),
        };
    }

    let any_files = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().next().is_some())
        .unwrap_or(false);
    if any_files {
        return Detected {
            kind: DetectedKind::StaticFolder,
            command: EMBEDDED_STATIC.into(),
            note: "No recognized entry — falling back to built-in static server".into(),
        };
    }

    Detected {
        kind: DetectedKind::Empty,
        command: String::new(),
        note: "Folder is empty".into(),
    }
}
