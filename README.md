# Cloudflare Tunnel Manager

A desktop app (Windows / macOS / Linux) for managing Cloudflare named tunnels and the public hostnames they expose. Built with Tauri 2, Rust, and React.

## Prerequisites

- Node 20+ and pnpm
- Rust 1.77+
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) on PATH
- Run `cloudflared tunnel login` once to authorize this machine

## Develop

```bash
pnpm install
pnpm tauri:dev
```

## Build

```bash
pnpm tauri:build
```

Output is placed in `src-tauri/target/release/bundle/`.

## Layout

- `src/` — React + TypeScript frontend
- `src-tauri/` — Rust backend (Tauri shell, SQLite, cloudflared supervisor)
- `docs/workflow/specs/` — design specs
- `docs/workflow/plans/` — implementation plans
- `docs/testing/manual-smoke.md` — smoke test checklist
