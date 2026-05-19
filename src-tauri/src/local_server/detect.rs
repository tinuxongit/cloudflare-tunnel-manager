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
    NodeStart,        // package.json with a "start" script
    NodeStatic,       // package.json without start, or just html files
    Python,           // main.py with Flask/Uvicorn-ish hints
    StaticFolder,     // any folder, fall back to a static server
    Empty,            // folder exists but has nothing recognizable
    NotFound,         // path doesn't exist
}

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
                let has_start = json.get("scripts")
                    .and_then(|s| s.get("start"))
                    .is_some();
                if has_start {
                    return Detected {
                        kind: DetectedKind::NodeStart,
                        command: "npm start".into(),
                        note: "Node project — runs `npm start` with PORT={PORT}".into(),
                    };
                }
            }
        }
        return Detected {
            kind: DetectedKind::NodeStatic,
            command: "npx --yes serve -p {PORT} -L .".into(),
            note: "Node project without start script — serves as static via `npx serve`".into(),
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
            command: "npx --yes serve -p {PORT} -L .".into(),
            note: "Static site (index.html present) — `npx serve`".into(),
        };
    }

    // Empty-ish folder but still try to serve as static.
    let any_files = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().next().is_some())
        .unwrap_or(false);
    if any_files {
        return Detected {
            kind: DetectedKind::StaticFolder,
            command: "npx --yes serve -p {PORT} -L .".into(),
            note: "No recognized entry — falling back to static serve".into(),
        };
    }

    Detected {
        kind: DetectedKind::Empty,
        command: String::new(),
        note: "Folder is empty".into(),
    }
}
