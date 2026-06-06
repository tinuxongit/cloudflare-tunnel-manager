//! Program-name resolver. `Command::new("node")` only searches the process's
//! PATH at spawn time — and on Windows the PATH that a process inherits is
//! whatever was in the shell when the process started, ignoring later changes
//! from installers like winget. That bites us in two places: setup detection
//! (the user has Node installed but we say it's missing) and local-server
//! spawning (Node IS available, but `Command::new("node")` fails because
//! PATH doesn't list its install dir).
//!
//! `resolve_program` covers both: try PATH first, then fall back to a
//! curated list of well-known install locations per platform.

use std::path::PathBuf;

/// Return a real on-disk path for `name` if we can find it via PATH or a
/// well-known install location. Used by the setup detector AND by the
/// local-server supervisor when spawning a user's run command.
pub fn resolve_program(name: &str) -> Option<PathBuf> {
    // 1. Direct PATH lookup.
    if let Ok(p) = which::which(name) {
        return Some(p);
    }
    // 2. Windows: try common executable suffixes.
    if cfg!(windows) {
        for suffix in [".exe", ".cmd", ".bat"] {
            if let Ok(p) = which::which(format!("{name}{suffix}")) {
                return Some(p);
            }
        }
    }
    // 3. Well-known install locations the user might have but with stale PATH.
    for candidate in well_known_paths(name) {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(windows)]
fn well_known_paths(name: &str) -> Vec<PathBuf> {
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let pf86 = std::env::var("ProgramFiles(x86)")
        .unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());
    let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let join = |parts: &[&str]| -> PathBuf { parts.iter().collect() };
    match name {
        "node" => vec![
            join(&[&pf, "nodejs", "node.exe"]),
            join(&[&pf86, "nodejs", "node.exe"]),
        ],
        "pnpm" => vec![
            join(&[&appdata, "npm", "pnpm.cmd"]),
            join(&[&local_app, "pnpm", "pnpm.exe"]),
            join(&[&local_app, "pnpm", "pnpm.cmd"]),
        ],
        "npm" => vec![
            join(&[&pf, "nodejs", "npm.cmd"]),
            join(&[&pf86, "nodejs", "npm.cmd"]),
            join(&[&appdata, "npm", "npm.cmd"]),
        ],
        "npx" => vec![
            join(&[&pf, "nodejs", "npx.cmd"]),
            join(&[&pf86, "nodejs", "npx.cmd"]),
        ],
        "yarn" => vec![
            join(&[&appdata, "npm", "yarn.cmd"]),
        ],
        "git" => vec![
            join(&[&pf, "Git", "cmd", "git.exe"]),
            join(&[&pf86, "Git", "cmd", "git.exe"]),
        ],
        "python" | "python3" => vec![
            join(&[&local_app, "Programs", "Python", "Python313", "python.exe"]),
            join(&[&local_app, "Programs", "Python", "Python312", "python.exe"]),
            join(&[&local_app, "Programs", "Python", "Python311", "python.exe"]),
            join(&[&pf, "Python313", "python.exe"]),
            join(&[&pf, "Python312", "python.exe"]),
        ],
        "cloudflared" => vec![
            join(&[&local_app, "Microsoft", "WinGet", "Packages",
                   "Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe",
                   "cloudflared.exe"]),
            join(&[&pf, "cloudflared", "cloudflared.exe"]),
        ],
        "cargo" => vec![join(&[&userprofile, ".cargo", "bin", "cargo.exe"])],
        "code" => vec![
            join(&[&local_app, "Programs", "Microsoft VS Code", "bin", "code.cmd"]),
            join(&[&pf, "Microsoft VS Code", "bin", "code.cmd"]),
        ],
        "cursor" => vec![
            join(&[&local_app, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"]),
            join(&[&local_app, "Programs", "Cursor", "resources", "app", "bin", "cursor.cmd"]),
        ],
        "wrangler" => vec![join(&[&appdata, "npm", "wrangler.cmd"])],
        _ => Vec::new(),
    }
}

#[cfg(not(windows))]
fn well_known_paths(name: &str) -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let join = |parts: &[&str]| -> PathBuf { parts.iter().collect() };
    match name {
        "node"        => vec![join(&["/usr/local/bin/node"]), join(&["/usr/bin/node"]), join(&["/opt/homebrew/bin/node"])],
        "pnpm"        => vec![join(&[&home, ".local/share/pnpm/pnpm"]), join(&["/usr/local/bin/pnpm"]), join(&["/opt/homebrew/bin/pnpm"])],
        "npm"         => vec![join(&["/usr/local/bin/npm"]), join(&["/usr/bin/npm"]), join(&["/opt/homebrew/bin/npm"])],
        "npx"         => vec![join(&["/usr/local/bin/npx"]), join(&["/usr/bin/npx"]), join(&["/opt/homebrew/bin/npx"])],
        "yarn"        => vec![join(&["/usr/local/bin/yarn"]), join(&["/usr/bin/yarn"]), join(&["/opt/homebrew/bin/yarn"])],
        "git"         => vec![join(&["/usr/bin/git"]), join(&["/usr/local/bin/git"]), join(&["/opt/homebrew/bin/git"])],
        "python" | "python3" => vec![join(&["/usr/bin/python3"]), join(&["/usr/local/bin/python3"]), join(&["/opt/homebrew/bin/python3"])],
        "cloudflared" => vec![join(&["/usr/local/bin/cloudflared"]), join(&["/usr/bin/cloudflared"]), join(&["/opt/homebrew/bin/cloudflared"])],
        "cargo"       => vec![join(&[&home, ".cargo/bin/cargo"])],
        "code"        => vec![join(&["/usr/local/bin/code"]), join(&["/usr/bin/code"])],
        "cursor"      => vec![join(&["/usr/local/bin/cursor"])],
        "wrangler"    => vec![join(&[&home, ".local/share/pnpm/wrangler"])],
        _ => Vec::new(),
    }
}
