import { create } from 'zustand';
import { api } from './ipc';
import type { Page, Tunnel, Settings, RuntimeStatus, CloudflaredInfo } from './types';

type View = 'pages' | 'tunnels' | 'logs' | 'health' | 'settings';

type Store = {
  view: View;
  setView: (v: View) => void;

  cloudflared: CloudflaredInfo | null;
  pages: Page[];
  tunnels: Tunnel[];
  settings: Settings | null;
  statusByTunnel: Record<string, RuntimeStatus | undefined>;

  refreshSystem: () => Promise<void>;
  refreshPages:  () => Promise<void>;
  refreshTunnels: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setStatus: (uuid: string, st: RuntimeStatus) => void;
};

export const useStore = create<Store>((set, get) => ({
  view: 'pages',
  setView: (v) => set({ view: v }),
  cloudflared: null,
  pages: [],
  tunnels: [],
  settings: null,
  statusByTunnel: {},

  refreshSystem:   async () => set({ cloudflared: await api.cloudflaredInfo() }),
  refreshPages:    async () => set({ pages: await api.listPages() }),
  refreshTunnels:  async () => set({ tunnels: await api.listTunnels() }),
  refreshSettings: async () => set({ settings: await api.getSettings() }),
  setStatus: (uuid, st) => set({ statusByTunnel: { ...get().statusByTunnel, [uuid]: st } }),
}));
