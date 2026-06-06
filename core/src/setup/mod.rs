//! Setup-detector — checks whether the tools CS needs are installed and
//! offers winget-based install on Windows.
//!
//! Tools we care about:
//!   - node       (required by wrangler / pnpm; check first since others depend on it)
//!   - pnpm       (required for project install / deploy)
//!   - rust       (required only if building DataBrick-style Tauri apps from CS itself)
//!   - cloudflared (required for tunnels — but not Workers)
//!   - git        (recommended)
//!   - code       (optional — "Open in editor")
//!   - cursor     (optional)

pub mod install;

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ToolStatus {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub version: Option<String>,
    /// Human-readable reason this tool matters.
    pub required_for: String,
    /// `"essential"`, `"recommended"`, or `"optional"`.
    pub importance: String,
    pub install: Option<InstallInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallInfo {
    /// `"winget"` or `"npm-global"` or `"manual"`.
    pub kind: String,
    /// For winget: the package id. For npm-global: the package name. For manual: a download URL.
    pub target: String,
    /// Whether the install can run without admin elevation.
    pub needs_admin: bool,
}

fn which_path(name: &str) -> Option<PathBuf> {
    // Resolve via the shared path resolver — same fallback paths the local
    // server uses when spawning user commands. Keeps detection and runtime
    // spawning in sync so we never say "X is installed" but fail to start it.
    crate::resolve::resolve_program(name)
}

/// Run `bin --version` (or whatever flag) and return the first line.
fn try_version(bin: &PathBuf, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(bin).args(args).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).to_string();
    let line = s.lines().next()?.trim().to_string();
    if line.is_empty() {
        let serr = String::from_utf8_lossy(&out.stderr).to_string();
        serr.lines().next().map(|l| l.trim().to_string())
    } else {
        Some(line)
    }
}

fn detect(id: &str, label: &str, bin: &str, version_args: &[&str],
          required_for: &str, importance: &str, install: Option<InstallInfo>) -> ToolStatus {
    let path = which_path(bin);
    let installed = path.is_some();
    let version = path.as_ref().and_then(|p| try_version(p, version_args));
    ToolStatus {
        id: id.into(),
        label: label.into(),
        installed,
        version,
        required_for: required_for.into(),
        importance: importance.into(),
        install,
    }
}

fn winget(id: &str) -> InstallInfo {
    InstallInfo { kind: "winget".into(), target: id.into(), needs_admin: false }
}
fn npm_global(pkg: &str) -> InstallInfo {
    InstallInfo { kind: "npm-global".into(), target: pkg.into(), needs_admin: false }
}
fn manual(url: &str) -> InstallInfo {
    InstallInfo { kind: "manual".into(), target: url.into(), needs_admin: false }
}

pub fn detect_all() -> Vec<ToolStatus> {
    vec![
        detect("node", "Node.js", "node", &["--version"],
            "Required — wrangler and pnpm are Node-based.",
            "essential",
            Some(if cfg!(windows) { winget("OpenJS.NodeJS") } else { manual("https://nodejs.org") })),

        detect("pnpm", "pnpm", "pnpm", &["--version"],
            "Required — used to install project deps and run wrangler.",
            "essential",
            // pnpm install needs Node first, so we use npm (which ships with Node).
            Some(npm_global("pnpm"))),

        detect("cloudflared", "cloudflared", "cloudflared", &["--version"],
            "Needed for Tunnels (Routes / Tunnels sections). Workers don't need it.",
            "recommended",
            Some(if cfg!(windows) { winget("Cloudflare.cloudflared") } else { manual("https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/") })),

        detect("git", "Git", "git", &["--version"],
            "Recommended — version-control your projects.",
            "recommended",
            Some(if cfg!(windows) { winget("Git.Git") } else { manual("https://git-scm.com") })),

        detect("rust", "Rust", "cargo", &["--version"],
            "Only needed if you build Tauri-style desktop apps from CS.",
            "optional",
            Some(if cfg!(windows) { winget("Rustlang.Rustup") } else { manual("https://rustup.rs") })),

        detect("code", "VS Code", "code", &["--version"],
            "Optional — \"Open in editor\" uses it.",
            "optional",
            Some(if cfg!(windows) { winget("Microsoft.VisualStudioCode") } else { manual("https://code.visualstudio.com") })),

        detect("cursor", "Cursor", "cursor", &["--version"],
            "Optional — \"Open in editor\" prefers Cursor over VS Code if both are installed.",
            "optional",
            Some(if cfg!(windows) { winget("Anysphere.Cursor") } else { manual("https://cursor.sh") })),
    ]
}


/// Resolve the install command + args for a given tool. The caller spawns
/// it via the wrangler subprocess wrapper so output streams into the
/// existing slide-out terminal.
///
/// Returns (program, args) — None when there's no auto-install path.
pub fn install_command(info: &InstallInfo) -> Option<(PathBuf, Vec<String>)> {
    match info.kind.as_str() {
        "winget" => {
            let winget = which_path("winget")?;
            Some((winget, vec![
                "install".into(),
                "--id".into(),
                info.target.clone(),
                "--exact".into(),
                "--accept-source-agreements".into(),
                "--accept-package-agreements".into(),
                "--disable-interactivity".into(),
            ]))
        }
        "npm-global" => {
            let npm = which_path("npm")?;
            Some((npm, vec!["install".into(), "-g".into(), info.target.clone()]))
        }
        "manual" => None,
        _ => None,
    }
}
