import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function TitleBar() {
  const win = getCurrentWindow();
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaxed);
    const un = win.onResized(async () => setMaxed(await win.isMaximized()));
    return () => { un.then(f => f()); };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between px-3 bg-side border-b border-border-strong select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 flex-1 text-[11px] font-mono text-fg-dim tracking-wide">
        <span className="w-4 h-4 rounded bg-gradient-to-br from-fg to-fg-muted text-bg flex items-center justify-center font-bold text-[10px]">⌘</span>
        Cloudflare Tunnel Manager
      </div>
      <div className="flex items-center gap-px">
        <CtlBtn onClick={() => win.minimize()} label="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor"/></svg>
        </CtlBtn>
        <CtlBtn onClick={() => win.toggleMaximize()} label="Maximize">
          {maxed ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0.5" width="7" height="7"/>
              <rect x="0.5" y="2" width="7" height="7" fill="#0a0a0c"/>
              <rect x="0.5" y="2" width="7" height="7"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9"/>
            </svg>
          )}
        </CtlBtn>
        <CtlBtn onClick={() => win.close()} label="Close" danger>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
            <line x1="0" y1="0" x2="10" y2="10"/>
            <line x1="10" y1="0" x2="0" y2="10"/>
          </svg>
        </CtlBtn>
      </div>
    </div>
  );
}

function CtlBtn({ onClick, children, label, danger }: { onClick: () => void; children: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-11 h-9 flex items-center justify-center text-fg-muted transition
        ${danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-bg-elev hover:text-fg'}`}
    >
      {children}
    </button>
  );
}
