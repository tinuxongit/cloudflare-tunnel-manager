/**
 * Global deploy-terminal store. One sliding panel renders at the app root
 * and any "Deploy" button anywhere in the app pushes its event stream here.
 *
 * Works identically in local and remote modes — `streamProjectProgress`
 * picks the right transport (Tauri events vs SSE) based on connection mode.
 */
import { create } from 'zustand';
import type { ProjectProgress } from './types';
import { streamProjectProgress, type Stop } from './events';

type State = {
  open: boolean;
  label: string;
  events: ProjectProgress[];
  done: boolean;
  error: boolean;
  autoCloseTimer: ReturnType<typeof setTimeout> | null;
  stop: Stop | null;

  /**
   * Subscribe to a deploy event channel and show progress in the terminal.
   * `onComplete` fires once when the deploy finishes (success or error) —
   * callers should refresh their state THEN, not on a setTimeout, otherwise
   * they race the actual deploy and read stale data.
   */
  start: (label: string, eventId: string, onComplete?: (success: boolean) => void) => Promise<void>;
  close: () => void;
};

export const useDeployTerminal = create<State>((set, get) => ({
  open: false,
  label: '',
  events: [],
  done: false,
  error: false,
  autoCloseTimer: null,
  stop: null,

  start: async (label, eventId, onComplete) => {
    const prev = get();
    if (prev.stop) { try { await prev.stop(); } catch {} }
    if (prev.autoCloseTimer) clearTimeout(prev.autoCloseTimer);

    set({ open: true, label, events: [], done: false, error: false, autoCloseTimer: null, stop: null });

    const stop = await streamProjectProgress(eventId, (evt: ProjectProgress) => {
      set((s) => ({ events: [...s.events, evt] }));
      if (evt.kind === 'success' || evt.kind === 'error') {
        const errored = evt.kind === 'error';
        const s = get();
        if (s.stop) { try { Promise.resolve(s.stop()).catch(() => {}); } catch {} }
        set({ done: true, error: errored, stop: null });
        if (!errored) {
          const t = setTimeout(() => set({ open: false }), 4000);
          set({ autoCloseTimer: t });
        }
        try { onComplete?.(!errored); } catch (err) { console.error('onComplete failed', err); }
      }
    });
    set({ stop });
  },

  close: () => {
    const s = get();
    if (s.stop) { try { Promise.resolve(s.stop()).catch(() => {}); } catch {} }
    if (s.autoCloseTimer) clearTimeout(s.autoCloseTimer);
    set({ open: false, stop: null, autoCloseTimer: null });
  },
}));
