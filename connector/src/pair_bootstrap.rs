//! Spawn `cloudflared tunnel --url localhost:<port>` using the bootstrapped
//! cloudflared binary (downloaded on first run, cached afterwards) and parse
//! the public `https://<random-words>.trycloudflare.com` URL out of stderr.
//!
//! The "code" the user pastes into Studio is `<random-words>:<secret>` —
//! the words let Studio reconstruct the URL, the secret gates the handshake
//! against random scanners hitting trycloudflare subdomains.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::{anyhow, Context};
use rand::Rng;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::time::timeout;

const TRYCLOUDFLARE_HINT: &str = "trycloudflare.com";
const STARTUP_TIMEOUT_SECS: u64 = 60;

pub struct QuickTunnel {
    /// Full URL of the Quick Tunnel, e.g. `https://harrison-tom-jersey-tons.trycloudflare.com`.
    pub url: String,
    /// Just the subdomain prefix, e.g. `harrison-tom-jersey-tons`.
    pub subdomain: String,
    /// Random 4-char secret minted on startup. Gates `/pair/handshake/<secret>`.
    pub secret: String,
    /// Child process — keep alive for the connector's lifetime.
    pub child: Child,
}

pub async fn spawn_quick_tunnel(
    cloudflared_path: PathBuf,
    local_port: u16,
) -> anyhow::Result<QuickTunnel> {
    let mut child = Command::new(&cloudflared_path)
        .args([
            "tunnel",
            "--no-autoupdate",
            "--url",
            &format!("http://localhost:{local_port}"),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("spawn {}", cloudflared_path.display()))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let (tx, rx) = oneshot::channel::<String>();
    let tx = std::sync::Arc::new(parking_lot::Mutex::new(Some(tx)));

    fn try_send(
        tx: &std::sync::Arc<parking_lot::Mutex<Option<oneshot::Sender<String>>>>,
        url: String,
    ) {
        if let Some(sender) = tx.lock().take() {
            let _ = sender.send(url);
        }
    }

    let tx_stdout = tx.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!(target: "cloudflared", "stdout: {line}");
            if let Some(url) = extract_trycloudflare_url(&line) {
                try_send(&tx_stdout, url);
            }
        }
    });
    let tx_stderr = tx.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!(target: "cloudflared", "stderr: {line}");
            if let Some(url) = extract_trycloudflare_url(&line) {
                try_send(&tx_stderr, url);
            }
        }
    });

    let url = match timeout(Duration::from_secs(STARTUP_TIMEOUT_SECS), rx).await {
        Ok(Ok(url)) => url,
        Ok(Err(_)) => anyhow::bail!(
            "cloudflared exited before printing a public URL. Try running it manually to debug."
        ),
        Err(_) => anyhow::bail!(
            "timed out waiting {STARTUP_TIMEOUT_SECS}s for cloudflared to print a public URL."
        ),
    };

    let subdomain = url
        .strip_prefix("https://")
        .and_then(|s| s.split('.').next())
        .ok_or_else(|| anyhow!("couldn't parse subdomain out of {url}"))?
        .to_string();

    let secret = new_secret();

    Ok(QuickTunnel { url, subdomain, secret, child })
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    let idx = line.find("https://")?;
    let tail = &line[idx..];
    let end = tail.find(char::is_whitespace).unwrap_or(tail.len());
    let candidate = tail[..end].trim_end_matches([',', '.', ';']);
    if candidate.contains(TRYCLOUDFLARE_HINT) {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn new_secret() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..4)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}
