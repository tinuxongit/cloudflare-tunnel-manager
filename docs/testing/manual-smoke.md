# Manual Smoke Test — Cloudflare Tunnel Manager

Run before any release. Assumes cloudflared installed and `cloudflared tunnel login` complete.

## 1. First launch
- [ ] `pnpm tauri:dev` opens a window with sidebar + Pages view
- [ ] cloudflared version visible in sidebar footer
- [ ] No setup banner shown if logged in

## 2. Read existing tunnels
- [ ] Open Tunnels view → at least one tunnel listed from `cloudflared tunnel list`

## 3. Add a page
- [ ] Click "+ Add page" → dialog opens
- [ ] Enter a hostname whose zone exists in your Cloudflare account
- [ ] Service URL: `http://localhost:8080` (start `python -m http.server 8080` first)
- [ ] Pick a tunnel → Submit → row appears

## 4. Toggle on
- [ ] Click toggle → switch moves right, status flips to "online" within ~5s
- [ ] Open the hostname in a browser → see the Python directory listing
- [ ] Status row shows edge region and req/s climbs

## 5. Toggle off
- [ ] Click toggle → status flips to "off" within 2s
- [ ] Browser request to hostname returns 502 or times out

## 6. Multi-page shared mode
- [ ] Add a second page on a different localhost port (start a second `http.server`)
- [ ] Toggle both on
- [ ] Both reachable via their hostnames
- [ ] Only ONE `cloudflared` process in Task Manager

## 7. Switch to isolated
- [ ] Settings → grouping mode → isolated
- [ ] Toggle pages off then on
- [ ] Now TWO cloudflared procs in Task Manager (one per page)

## 8. Auto-restart on crash
- [ ] Kill the cloudflared proc from Task Manager
- [ ] App marks state "starting" then "online" within ~10s
- [ ] After 3 forced kills in 1 minute, page marks "error" and stops auto-restart

## 9. Logs view
- [ ] Switch to Logs → pick the running tunnel → live tail visible

## 10. Health view
- [ ] Switch to Health → "Recheck all" → each page shows HTTP status + latency

## 11. Delete page
- [ ] ⋯ menu → Delete page → page disappears from list
- [ ] Backend regenerates config for sibling pages on same tunnel
