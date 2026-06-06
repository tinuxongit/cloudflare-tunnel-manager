import { create } from 'zustand';
import { api } from './ipc';
import { getConnection } from './connection';
import { openStateStream } from './sse';
import type { Page, Tunnel, Settings, RuntimeStatus, CloudflaredInfo, Zone, ToolStatus, StateEvent } from './types';

// "routes" is the new UI label for what the codebase still calls Page
// internally (hostname → local service via a tunnel). Kept the internal type
// name because renaming the Rust + TS types across 20 files isn't worth the
// churn — the rename is a label-only change for users.
type View =
  | 'dashboard'
  | 'projects'
  | 'routes'
  | 'tunnels'
  | 'workers'
  | 'd1'
  | 'r2'
  | 'dns'
  | 'cf-pages'
  | 'files'
  | 'logs'
  | 'health'
  | 'settings';

type Store = {
  view: View;
  setView: (v: View) => void;

  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  cloudflared: CloudflaredInfo | null;
  pages: Page[];
  tunnels: Tunnel[];
  settings: Settings | null;
  zones: Zone[];
  hasApiToken: boolean;
  hasToken: boolean;
  statusByTunnel: Record<string, RuntimeStatus | undefined>;

  // Tool-detection cache — populated once at boot so the Settings view doesn't
  // re-spawn `--version` probes on every navigation.
  setupTools: ToolStatus[] | null;
  setupError: string | null;

  // Per-resource "tick" counters. Views that fetch their own data (workers,
  // R2 buckets, D1 databases, DNS records, projects) include the relevant
  // tick as a useEffect dep — when the realtime SSE bus says the resource
  // changed, the tick increments and the view re-fetches. Cheaper than
  // storing every resource list in the store.
  workersTick: number;
  r2Tick: number;
  d1Tick: number;
  dnsTick: number;
  projectsTick: number;

  refreshSystem: () => Promise<void>;
  refreshPages:  () => Promise<void>;
  refreshTunnels: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshZones: () => Promise<void>;
  refreshTokenState: () => Promise<void>;
  refreshSetup: () => Promise<void>;
  setStatus: (uuid: string, st: RuntimeStatus) => void;

  // ── Realtime SSE sync (remote mode only) ─────────────────────────
  realtimeStop: (() => void) | null;
  realtimeConnect: () => void;
  realtimeDisconnect: () => void;
};

export const useStore = create<Store>((set, get) => ({
  view: 'dashboard',
  setView: (v) => set({ view: v }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  cloudflared: null,
  pages: [],
  tunnels: [],
  settings: null,
  zones: [],
  hasApiToken: false,
  hasToken: false,
  statusByTunnel: {},
  setupTools: null,
  setupError: null,
  workersTick: 0,
  r2Tick: 0,
  d1Tick: 0,
  dnsTick: 0,
  projectsTick: 0,

  refreshSystem: async () => {
    try { set({ cloudflared: await api.cloudflaredInfo() }); }
    catch (e: any) { console.error('[refreshSystem]', e?.message ?? e, e); throw e; }
  },
  refreshPages: async () => {
    try { set({ pages: await api.listPages() }); }
    catch (e: any) { console.error('[refreshPages]', e?.message ?? e, e); throw e; }
  },
  refreshTunnels: async () => {
    try { set({ tunnels: await api.listTunnels() }); }
    catch (e: any) { console.error('[refreshTunnels]', e?.message ?? e, e); throw e; }
  },
  refreshSettings: async () => {
    try { set({ settings: await api.getSettings() }); }
    catch (e: any) { console.error('[refreshSettings]', e?.message ?? e, e); throw e; }
  },
  refreshZones: async () => {
    try {
      const z = await api.listZones();
      set({ zones: z });
    } catch {
      set({ zones: [] });
    }
  },
  refreshSetup: async () => {
    try {
      const tools = await api.detectSetup();
      set({ setupTools: tools, setupError: null });
    } catch (e: any) {
      set({ setupTools: [], setupError: e?.message ?? String(e) });
    }
  },
  refreshTokenState: async () => {
    try {
      // hasToken = any credential is configured (Bearer OR Global Key).
      // The backend's resolve_credentials() picks whichever is set.
      const [tok, gk] = await Promise.all([api.hasApiToken(), api.hasGlobalKey()]);
      set({ hasApiToken: tok, hasToken: tok || gk });
    } catch { set({ hasApiToken: false, hasToken: false }); }
  },
  setStatus: (uuid, st) => set({ statusByTunnel: { ...get().statusByTunnel, [uuid]: st } }),

  realtimeStop: null,
  realtimeConnect: () => {
    // Only meaningful in remote mode. In local mode the frontend acts on
    // direct command results + Tauri events; there's no separate process to
    // sync with.
    if (getConnection().mode !== 'remote') return;
    const existing = get().realtimeStop;
    if (existing) return;
    const stop = openStateStream((evt: StateEvent) => {
      const s = get();
      switch (evt.kind) {
        case 'pages_changed':    s.refreshPages().catch(() => {}); break;
        case 'tunnels_changed':  s.refreshTunnels().catch(() => {}); break;
        case 'tunnel_status':
          // Patch the supervisor-level state field without clobbering
          // metrics fields we don't have here.
          set((cur) => ({
            statusByTunnel: {
              ...cur.statusByTunnel,
              [evt.uuid]: {
                ...(cur.statusByTunnel[evt.uuid] ?? {
                  state: 'stopped', connections: null, edge_region: null,
                  requests_per_s: null, p50_ms: null, errors_total: null,
                }),
                state: evt.state,
              },
            },
          }));
          break;
        case 'projects_changed': set((cur) => ({ projectsTick: cur.projectsTick + 1 })); break;
        case 'settings_changed': s.refreshSettings().catch(() => {}); break;
        case 'secrets_changed':  s.refreshTokenState().catch(() => {}); break;
        case 'tools_changed':    s.refreshSetup().catch(() => {}); break;
        case 'workers_changed':  set((cur) => ({ workersTick: cur.workersTick + 1 })); break;
        case 'r2_changed':       set((cur) => ({ r2Tick: cur.r2Tick + 1 })); break;
        case 'd1_changed':       set((cur) => ({ d1Tick: cur.d1Tick + 1 })); break;
        case 'dns_changed':      set((cur) => ({ dnsTick: cur.dnsTick + 1 })); break;
      }
    });
    set({ realtimeStop: stop });
  },
  realtimeDisconnect: () => {
    const stop = get().realtimeStop;
    if (stop) { try { stop(); } catch {} }
    set({ realtimeStop: null });
  },
}));
