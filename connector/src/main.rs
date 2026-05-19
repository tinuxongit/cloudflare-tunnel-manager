mod auth;
mod config;
mod error;
mod routes;
mod server;
mod state;

use std::sync::Arc;

use anyhow::Context;
use clap::Parser;
use tracing::info;

use cf_tunnel_core::cloudflared::cli::CloudflaredCli;
use cf_tunnel_core::state::AppState;

use auth::PairingStore;
use config::Config;
use state::ConnectorState;

#[derive(clap::Parser)]
#[command(name = "cf-tunnel-connector", version, about = "Headless Cloudflare Tunnel HTTP API server")]
enum Cli {
    /// Run the HTTP server (default)
    Serve(ServeArgs),
    /// Print or regenerate the pairing code
    ShowCode,
    /// Forget the currently paired manager so a new one can pair
    ResetPairing,
    /// Print the config file path
    ConfigPath,
}

#[derive(clap::Args)]
struct ServeArgs {
    /// Override bind address (e.g. 127.0.0.1:8088)
    #[arg(long)]
    bind: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::try_parse().unwrap_or(Cli::Serve(ServeArgs { bind: None }));

    match cli {
        Cli::Serve(args) => serve(args).await,
        Cli::ShowCode => show_code(),
        Cli::ResetPairing => reset_pairing(),
        Cli::ConfigPath => {
            println!("{}", Config::path().display());
            Ok(())
        }
    }
}

async fn serve(args: ServeArgs) -> anyhow::Result<()> {
    // 1. Load config
    let mut config = Config::load();
    if let Some(bind) = args.bind {
        config.bind_addr = bind;
    }

    // 2. Resolve cloudflared path
    let cloudflared_path = CloudflaredCli::discover()
        .map(|c| c.path)
        .unwrap_or_else(|_| std::path::PathBuf::from("cloudflared"));

    // 3. Build AppState — data lives in <config_dir>/cf-tunnel-connector/data
    let data_dir = {
        let base = dirs::config_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        base.join("cf-tunnel-connector").join("data")
    };
    let core = AppState::init(data_dir.clone(), cloudflared_path)
        .context("failed to initialise AppState")?;
    let core = Arc::new(core);

    // 4. Pairing setup
    let pairing = Arc::new(PairingStore::new());

    let is_paired = config.paired_token.is_some();
    let connector_state = ConnectorState::new(core, config, pairing.clone());

    if !is_paired {
        let code = pairing.issue();
        eprintln!();
        eprintln!("╔══════════════════════════════════════╗");
        eprintln!("║  cf-tunnel-connector — UNPAIRED      ║");
        eprintln!("║                                      ║");
        eprintln!("║  Pairing code: {code:<22}║");
        eprintln!("║  (expires in 10 minutes)             ║");
        eprintln!("╚══════════════════════════════════════╝");
        eprintln!();
        eprintln!("Paste this code into the manager UI or call:");
        eprintln!("  POST /pair {{\"code\": \"{code}\"}}");
        eprintln!();
    } else {
        info!("connector is paired; bearer auth active");
    }

    // 5. Bind address
    let bind_addr = connector_state.config.lock().bind_addr.clone();
    info!("binding on {bind_addr}");

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("failed to bind {bind_addr}"))?;

    // 6. Build router
    let router = server::build(connector_state);

    // 7. Serve with graceful shutdown on Ctrl-C / SIGINT
    info!("cf-tunnel-connector listening on {bind_addr}");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    info!("server stopped");
    Ok(())
}

fn show_code() -> anyhow::Result<()> {
    let config = Config::load();
    if config.paired_token.is_some() {
        eprintln!("Already paired. Run `cf-tunnel-connector reset-pairing` first.");
        std::process::exit(1);
    }

    // The pairing store is in-process only; show-code just prints a fresh one.
    let code = auth::new_pairing_code();
    println!("{code}");
    eprintln!("(Note: this code is informational only — the running server generates its own.)");
    Ok(())
}

fn reset_pairing() -> anyhow::Result<()> {
    let mut config = Config::load();
    if config.paired_token.is_none() {
        eprintln!("Not currently paired.");
        return Ok(());
    }
    config.paired_token = None;
    config.save().context("failed to save config")?;
    println!("Pairing reset. Restart the server to accept a new pairing.");
    Ok(())
}

async fn shutdown_signal() {
    // Cross-platform: wait for Ctrl-C
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl-C handler");
    info!("shutdown signal received");
}
