import { createContext, useContext, useEffect, useState } from 'react';

// Tauri 2's webview silently ignores window.confirm(), so every "if
// (!confirm(...)) return" guard in the app would fall through and run
// destructive actions immediately. This provider exposes an async confirm()
// backed by a real modal — drop-in replacement: `if (!await confirm({...})) return`.

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'normal' | 'danger';
};

type Resolver = (ok: boolean) => void;
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmCtx);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: Resolver } | null>(null);

  const ask: ConfirmFn = (opts) =>
    new Promise<boolean>((resolve) => setState({ opts, resolve }));

  function close(ok: boolean) {
    state?.resolve(ok);
    setState(null);
  }

  // Escape closes as cancel, Enter as confirm. Only mount while open.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <ConfirmModal
          opts={state.opts}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

function ConfirmModal({
  opts, onConfirm, onCancel,
}: {
  opts: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const danger = opts.variant === 'danger';
  const confirmCls = danger
    ? 'text-red-100 bg-red-500/80 border border-red-500 hover:bg-red-500'
    : 'text-bg bg-gradient-to-b from-zinc-50 to-zinc-300 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset]';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className={`bg-[linear-gradient(180deg,#111217,#0b0c10)] border rounded-md w-[460px] max-w-full shadow-[0_28px_120px_rgba(0,0,0,0.65)]
          ${danger ? 'border-red-900/40' : 'border-zinc-700/70'}`}
        onClick={(e) => e.stopPropagation()}>
        <header className="px-6 pt-6 pb-3 flex items-start gap-3">
          {danger && (
            <span className="h-8 w-8 rounded-full border border-red-500/40 bg-red-500/10 text-red-300 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{opts.title}</h2>
            {opts.message && (
              <p className="text-sm text-fg-muted mt-2 whitespace-pre-line">{opts.message}</p>
            )}
          </div>
        </header>
        <div className="px-6 pb-5 pt-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 px-4 text-xs border border-border-strong rounded-md text-fg-muted hover:text-fg hover:bg-bg-elev transition">
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`h-9 px-4 text-xs font-semibold rounded-md transition ${confirmCls}`}>
            {opts.confirmLabel ?? (danger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
