//! Ensures a `cloudflared` binary is available for the connector to spawn
//! Quick Tunnels with — no manual install required on the server.
//!
//! Order of preference:
//!   1. System PATH (`which cloudflared`) — respects user's choice if they
//!      already have one installed.
//!   2. App data dir (`<config_dir>/cf-tunnel-connector/cloudflared/<exe>`).
//!   3. Download from the official Cloudflare GitHub release URL into (2)
//!      and use that going forward.
//!
//! The download is ~30 MB but only happens once per server.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Returns a usable path to a cloudflared binary. Downloads it if needed.
pub async fn ensure_cloudflared(cache_dir: &Path) -> AppResult<PathBuf> {
    // 1. System PATH
    if let Ok(p) = which::which(exe_name()) {
        return Ok(p);
    }

    // 2. Cached
    let target = cached_path(cache_dir);
    if target.exists() {
        return Ok(target);
    }

    // 3. Download
    download_to(&target).await?;
    Ok(target)
}

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

fn cached_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join("cloudflared").join(exe_name())
}

/// Pick the right release asset for this OS+arch.
fn release_url() -> AppResult<&'static str> {
    // Cloudflare publishes per-platform binaries under stable filenames in
    // the "latest" GitHub release.
    let asset = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "cloudflared-windows-amd64.exe",
        ("windows", "x86")    => "cloudflared-windows-386.exe",
        ("linux",   "x86_64") => "cloudflared-linux-amd64",
        ("linux",   "aarch64")=> "cloudflared-linux-arm64",
        ("linux",   "arm")    => "cloudflared-linux-arm",
        ("macos",   "x86_64") => "cloudflared-darwin-amd64.tgz",
        ("macos",   "aarch64")=> "cloudflared-darwin-amd64.tgz", // CF doesn't ship arm64 mac standalone; the universal tgz includes both
        (os, arch) => {
            return Err(AppError::Other {
                message: format!(
                    "no automatic cloudflared download available for {os}/{arch}. \
                    Install cloudflared manually and ensure it's on PATH."
                ),
            });
        }
    };
    Ok(match asset {
        "cloudflared-windows-amd64.exe" =>
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
        "cloudflared-windows-386.exe" =>
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe",
        "cloudflared-linux-amd64" =>
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
        "cloudflared-linux-arm64" =>
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
        "cloudflared-linux-arm" =>
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm",
        "cloudflared-darwin-amd64.tgz" =>
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
        _ => unreachable!(),
    })
}

async fn download_to(target: &Path) -> AppResult<()> {
    let url = release_url()?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Other {
            message: format!("mkdir {}: {e}", parent.display()),
        })?;
    }

    eprintln!("Downloading cloudflared from {url}…");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::Other { message: format!("http client: {e}") })?;
    let resp = client.get(url).send().await.map_err(|e| AppError::Other {
        message: format!("download cloudflared: {e}"),
    })?;
    if !resp.status().is_success() {
        return Err(AppError::Other {
            message: format!("download cloudflared: HTTP {}", resp.status()),
        });
    }
    let bytes = resp.bytes().await.map_err(|e| AppError::Other {
        message: format!("download cloudflared body: {e}"),
    })?;

    // macOS asset is a .tgz; everything else is the raw binary.
    if url.ends_with(".tgz") {
        return Err(AppError::Other {
            message: "Automatic install on macOS isn't implemented yet. \
                     Install cloudflared via Homebrew: `brew install cloudflared`."
                .into(),
        });
    }

    std::fs::write(target, &bytes).map_err(|e| AppError::Other {
        message: format!("write {}: {e}", target.display()),
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(target)
            .map_err(|e| AppError::Other { message: format!("stat {}: {e}", target.display()) })?
            .permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(target, perms);
    }
    eprintln!("cloudflared installed at {}", target.display());
    Ok(())
}
