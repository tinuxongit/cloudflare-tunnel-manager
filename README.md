# Cloudflare Studio

A desktop app for Windows, macOS, and Linux that puts your Cloudflare account in one window: tunnels, Workers, D1, R2, DNS, Pages, and a few project scaffolds. Most of it talks to the Cloudflare API directly, so you can manage things with just an API token instead of the dashboard or the terminal.

## Download

The latest binaries are on the [Releases](../../releases) page:

- **`app.exe`** — the desktop app. Download it and double-click to run. Nothing to install.
- **`cf-tunnel-connector.exe`** — optional. A small agent you put on a headless or remote machine so Studio can manage that machine's tunnels over the network. Skip it if you only work locally.

The binaries aren't code-signed yet, so Windows SmartScreen will probably show an "unknown publisher" warning the first time. Choose *More info → Run anyway*.

## First run

1. Open **Settings** and paste a Cloudflare API token. There's a walkthrough that lists the exact scopes to turn on and links straight to the token page in your Cloudflare dashboard.
2. With the token in place, the Workers, D1, R2, DNS, and Pages sections work right away.
3. The **Tunnels** and **Routes** sections also need [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed and on your PATH. Run `cloudflared tunnel login` once to authorize it.
4. Scaffolding and deploying a new project needs Node and pnpm installed, since it shells out to `wrangler` under the hood.

Your token is kept in the operating system's credential store (Windows Credential Manager, macOS Keychain, or the Secret Service on Linux), not in a plain text file.

## What it covers

- **Projects** — scaffold and deploy a Worker, a Worker backed by D1, or a static site, without hand-writing config
- **Tunnels** — create and run cloudflared named tunnels
- **Routes** — point a hostname at a local service
- **Workers / D1 / R2 / DNS / Pages** — browse and edit the resources already in your account
- **Dashboard, Health, Logs** — an overview plus local cloudflared diagnostics

## Building it yourself

You'll need Node 20+, pnpm, and a stable Rust toolchain.

```
pnpm install
pnpm tauri:dev      # run the app in dev mode
pnpm tauri:build    # produce a release build
```

The connector is a standalone binary:

```
cargo build --release -p cf-tunnel-connector
```

If you build release binaries you intend to share, remap your home directory out of them so your username doesn't end up baked into the panic strings:

```
RUSTFLAGS="--remap-path-prefix=$HOME=/build" cargo build --release
```
