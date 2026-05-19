import { create } from 'zustand';
import { api } from './ipc';
import type { Page, Tunnel, Settings, RuntimeStatus, CloudflaredInfo, Zone } from './types';

type View = 'pages' | 'tunnels' | 'logs' | 'health' | 'settings';

type Store = {
  view: View;
  setView: (v: View) => void;

  cloudflared: CloudflaredInfo | null;
  pages: Page[];
  tunnels: Tunnel[];
  settings: Settings | null;
  zones: Zone[];
  hasToken: boolean;
  statusByTunnel: Record<string, RuntimeStatus | undefined>;

  refreshSystem: () => Promise<void>;
  refreshPages:  () => Promise<void>;
  refreshTunnels: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshZones: () => Promise<void>;
  refreshTokenState: () => Promise<void>;
  setStatus: (uuid: string, st: RuntimeStatus) => void;
};

export const useStore = create<Store>((set, get) => ({
  view: 'pages',
  setView: (v) => set({ view: v }),
  cloudflared: null,
  pages: [],
  tunnels: [],
  settings: null,
  zones: [],
  hasToken: false,
  statusByTunnel: {},

  refreshSystem:   async () => set({ cloudflared: await api.cloudflaredInfo() }),
  refreshPages:    async () => set({ pages: await api.listPages() }),
  refreshTunnels:  async () => set({ tunnels: await api.listTunnels() }),
  refreshSettings: async () => set({ settings: await api.getSettings() }),
  refreshZones: async () => {
    try {
      const z = await api.listZones();
      set({ zones: z });
    } catch {
      set({ zones: [] });
    }
  },
  refreshTokenState: async () => {
    try {
      // hasToken = any credential is configured (Bearer OR Global Key).
      // The backend's resolve_credentials() picks whichever is set.
      const [tok, gk] = await Promise.all([api.hasApiToken(), api.hasGlobalKey()]);
      set({ hasToken: tok || gk });
    } catch { set({ hasToken: false }); }
  },
  setStatus: (uuid, st) => set({ statusByTunnel: { ...get().statusByTunnel, [uuid]: st } }),
}));
