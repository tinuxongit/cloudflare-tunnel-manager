mod auth;
mod config;
mod error;
mod events;
mod pair_bootstrap;
mod routes;
mod server;
mod state;
mod watchers;

use std::io::Write;
use std::sync::Arc;

use anyhow::Context;
use clap::Parser;
use tracing::info;

use cf_tunnel_core::cloudflared::cli::CloudflaredCli;
use cf_tunnel_core::cloudflared::bootstrap::ensure_cloudflared;
use cf_tunnel_core::state::AppState;

use config::Config;
use state::ConnectorState;

#[derive(clap::Parser)]
#[command(
    name = "cf-tunnel-connector",
    version,
    about = "Cloudflare Tunnel Manager connector. Run with no args on the server; copy the printed code into Studio."
)]
enum Cli {
    /// Start the connector (default — same as running with no args).
    Serve(ServeArgs),
    /// Forget the current bearer token + force a fresh quick tunnel on next start.
    Reset,
    /// Print the config file path.
    ConfigPath,
}

#[derive(clap::Args)]
struct ServeArgs {
    /// Local bind address for the internal HTTP API. cloudflared dials this
    /// locally; you don't need to expose it to the LAN.
    #[arg(long, default_value = "127.0.0.1:8088")]
    bind: String,
}

impl Default for ServeArgs {
    fn default() -> Self {
        // Mirrors the clap default so the no-args path constructs the same
        // value clap would have parsed.
        Self { bind: "127.0.0.1:8088".to_string() }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let result = dispatch().await;
    if let Err(ref e) = result {
        eprintln!();
        eprintln!("Error: {e:#}");
        eprintln!();
        wait_for_keypress("Press Enter to close...");
    }
    result
}

async fn dispatch() -> anyhow::Result<()> {
    let cli = if std::env::args().len() <= 1 {
        Cli::Serve(ServeArgs::default())
    } else {
        Cli::parse()
    };
    match cli {
        Cli::Serve(args) => serve(args).await,
        Cli::Reset => reset(),
        Cli::ConfigPath => {
            println!("{}", Config::path().display());
            Ok(())
        }
    }
}

fn reset() -> anyhow::Result<()> {
    let mut config = Config::load();
    config.paired_token = None;
    config.save().context("save config after reset")?;
    println!("Reset done. Next start will mint a fresh pair token.");
    Ok(())
}

async fn serve(args: ServeArgs) -> anyhow::Result<()> {
    let mut config = Config::load();
    config.bind_addr = args.bind.clone();

    let data_dir = {
        let base = dirs::config_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        base.join("cf-tunnel-connector").join("data")
    };
    std::fs::create_dir_all(&data_dir).ok();

    let cloudflared_bin = ensure_cloudflared(&data_dir).await
        .context("locate cloudflared")?;
    info!("cloudflared at {}", cloudflared_bin.display());

    // 1. Bind FIRST so we know the actual port we got. If the user has
    //    another connector instance still running on 8088, we'll fall back
    //    to a free port automatically instead of exploding.
    let (listener, actual_addr) = bind_with_fallback(&args.bind).await?;
    let local_port = actual_addr.port();
    config.bind_addr = actual_addr.to_string();
    info!("listening on {actual_addr}");

    // 2. Spawn the Quick Tunnel pointing at whatever port we actually got.
    let quick = pair_bootstrap::spawn_quick_tunnel(cloudflared_bin.clone(), local_port)
        .await
        .context("spawn quick tunnel")?;

    // 3. Mint a bearer token if we don't have one yet, persist.
    let token = config.paired_token.clone().unwrap_or_else(|| {
        let t = auth::new_token();
        config.paired_token = Some(t.clone());
        let _ = config.save();
        t
    });

    let code = format!("{}-{}", quick.subdomain, quick.secret);
    print_paste_banner(&code, &quick.url);

    // 4. Build state, stash the secret + token so /pair/handshake/<secret>
    //    can hand the token to Studio when it dials in.
    let cloudflared_for_supervisor =
        CloudflaredCli::with_path(cloudflared_bin.clone()).path;
    let core = AppState::init(data_dir.clone(), cloudflared_for_supervisor)
        .context("failed to initialise AppState")?;
    let core = Arc::new(core);

    let connector_state = ConnectorState::new(core, config);
    connector_state
        .handshake
        .put(quick.secret.clone(), token);

    // Keep the Quick Tunnel alive for the lifetime of this process. Dropping
    // would kill its OS process and Studio would lose connectivity.
    {
        let mut child = quick.child;
        tokio::spawn(async move {
            let _ = child.wait().await;
            tracing::warn!("cloudflared quick tunnel exited; connector is no longer publicly reachable");
        });
    }

    watchers::spawn_tunnel_watcher(connector_state.core.clone(), connector_state.events.clone());
    let router = server::build(connector_state);

    info!("cf-tunnel-connector serving on {actual_addr}");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    Ok(())
}

/// Try the user's preferred bind address first. If the port is already in
/// use (most common cause: a stale connector instance), bind to `host:0`
/// so the OS picks a free port. The Quick Tunnel is spawned against
/// whichever port we actually got, so the caller doesn't have to care.
async fn bind_with_fallback(
    preferred: &str,
) -> anyhow::Result<(tokio::net::TcpListener, std::net::SocketAddr)> {
    match tokio::net::TcpListener::bind(preferred).await {
        Ok(l) => {
            let a = l.local_addr()?;
            return Ok((l, a));
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            eprintln!(
                "Port already in use ({preferred}). Likely a previous connector is still running. \
                Picking a free port automatically — both instances can coexist."
            );
        }
        Err(e) => return Err(anyhow::anyhow!("failed to bind {preferred}: {e}")),
    }
    let host = preferred.rsplit_once(':').map(|(h, _)| h).unwrap_or("127.0.0.1");
    let any = format!("{host}:0");
    let listener = tokio::net::TcpListener::bind(&any)
        .await
        .with_context(|| format!("failed to bind {any}"))?;
    let addr = listener.local_addr()?;
    Ok((listener, addr))
}

fn print_paste_banner(code: &str, url: &str) {
    // Lines we want to render. Width = longest line + padding. Every row gets
    // padded to the same width so the right border lines up. Box-drawing chars
    // are 1-column wide each, so byte len equals visual len here.
    let lines: Vec<String> = vec![
        "Cloudflare Tunnel Manager — connector ready".into(),
        String::new(),
        "Paste this into Cloudflare Studio →".into(),
        "Settings → Connection → Remote → \"Add server\":".into(),
        String::new(),
        format!("  {code}"),
        String::new(),
        format!("Quick tunnel: {url}"),
    ];
    // Some characters (em-dash, →, ") take multiple bytes; measure in chars.
    let width = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) + 4;
    let bar = "═".repeat(width);
    eprintln!();
    eprintln!("╔{bar}╗");
    for line in &lines {
        let pad = width - 2 - line.chars().count();
        eprintln!("║  {line}{spacer}║", spacer = " ".repeat(pad));
    }
    eprintln!("╚{bar}╝");
    eprintln!();
    let _ = std::io::stderr().flush();
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.ok();
    info!("shutdown signal received");
}

fn wait_for_keypress(prompt: &str) {
    use std::io::BufRead as _;
    eprint!("{prompt} ");
    let _ = std::io::stderr().flush();
    let mut buf = String::new();
    let _ = std::io::stdin().lock().read_line(&mut buf);
}
