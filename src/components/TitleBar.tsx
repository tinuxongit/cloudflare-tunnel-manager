import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

function reloadApp() {
  // Hard reload — drops React state, re-runs all useState initializers,
  // re-reads localStorage with fresh code. This is the "ctrl+shift+r" the
  // Tauri webview doesn't expose by default. We use it whenever data shape
  // / localStorage schema changes during dev or after big actions.
  window.location.reload();
}

export function TitleBar() {
  const win = getCurrentWindow();
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaxed);
    const un = win.onResized(async () => setMaxed(await win.isMaximized()));
    // Bind global reload shortcuts (Tauri webview ignores F5 / Ctrl+R by
    // default in some builds — bind them explicitly).
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        reloadApp();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { un.then(f => f()); window.removeEventListener('keydown', onKey); };
  }, []);

  return (
    <div className="h-11 flex items-stretch bg-[#08090c] border-b border-border-strong select-none relative">
      {/* Drag region — fills the whole bar; buttons sit on top and intercept clicks */}
      <div
        data-tauri-drag-region
        className="absolute inset-0"
      />
      <div
        data-tauri-drag-region
        className="flex items-center gap-3 px-4 flex-1 text-sm text-fg tracking-wide relative pointer-events-none"
      >
        <CloudflareLogo />
        <span className="font-semibold">Cloudflare Studio</span>
        <span className="font-mono text-[11px] text-fg-dim">v0.4.0</span>
      </div>
      <div className="flex items-stretch relative">
        <CtlBtn onClick={reloadApp} label="Reload (Ctrl+R / F5)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
        </CtlBtn>
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

function CloudflareLogo() {
  // Cloudflare cloud mark (from svgl.app) + a small wrench badge in the
  // bottom-right corner, sitting half on / half off the cloud — same metaphor
  // as the Windows shortcut-arrow overlay. Signals "Cloudflare Studio" =
  // "Cloudflare + a tool".
  //
  // ViewBox extended to 290×155 to accommodate the badge overhang. Aspect
  // ratio ~1.87:1; the title bar renders it at width 24 → height ~13.
  return (
    <svg viewBox="0 0 200 130" width="56" height="36" aria-label="Cloudflare Studio"
      className="shrink-0 drop-shadow-[0_0_10px_rgba(249,115,22,0.35)]">
      {/* ── Cloudflare cloud (original three paths), shrunk to 0.65× and
          nudged down so the gear has more relative weight in the composite. */}
      <g transform="translate(20 10) scale(0.65)">
        <path fill="#FFF" d="m202.357 49.394-5.311-2.124C172.085 103.434 72.786 69.289 66.81 85.997c-.996 11.286 54.227 2.146 93.706 4.059 12.039.583 18.076 9.671 12.964 24.484l10.069.031c11.615-36.209 48.683-17.73 50.232-29.68-2.545-7.857-42.601 0-31.425-35.497Z"/>
        <path fill="#F4811F" d="M176.332 108.348c1.593-5.31 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.31-11.154-5.842L71.17 87.634c-.531 0-1.062-.53-1.593-.53-.531-.532-.531-1.063 0-1.594.531-1.062 1.062-1.594 2.124-1.594l92.946-1.062c11.154-.53 22.839-9.56 27.087-20.182l5.312-13.809c0-.532.531-1.063 0-1.594C191.203 20.182 166.772 0 138.091 0 111.535 0 88.697 16.995 80.73 40.896c-5.311-3.718-11.684-5.843-19.12-5.31-12.747 1.061-22.838 11.683-24.432 24.43-.531 3.187 0 6.374.532 9.56C16.996 70.107 0 87.103 0 108.348c0 2.124 0 3.718.531 5.842 0 1.063 1.062 1.594 1.594 1.594h170.489c1.062 0 2.125-.53 2.125-1.594l1.593-5.842Z"/>
        <path fill="#FAAD3F" d="M205.544 48.863h-2.656c-.531 0-1.062.53-1.593 1.062l-3.718 12.747c-1.593 5.31-1.062 10.623 1.594 13.809 2.655 3.187 6.373 5.31 11.153 5.843l19.652 1.062c.53 0 1.062.53 1.593.53.53.532.53 1.063 0 1.594-.531 1.063-1.062 1.594-2.125 1.594l-20.182 1.062c-11.154.53-22.838 9.56-27.087 20.182l-1.063 4.78c-.531.532 0 1.594 1.063 1.594h70.108c1.062 0 1.593-.531 1.593-1.593 1.062-4.25 2.124-9.03 2.124-13.81 0-27.618-22.838-50.456-50.456-50.456"/>
      </g>

      {/* ── Gear overlay (sits inside the cloud's bottom-left puff). Solid
          white silhouette with the orange of the cloud showing through the
          center hole for the classic settings-cog look. Slight overhang for
          the "shortcut badge" effect. */}
      <g transform="translate(40 80) scale(3.1) translate(-12 -12)">
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          fill="#fafafa" stroke="#0b0d11" strokeWidth="0.6" strokeLinejoin="round" />
        {/* Center hole — filled with cloud orange so it reads as a hole */}
        <circle cx="12" cy="12" r="3" fill="#F4811F" />
      </g>
    </svg>
  );
}

function CtlBtn({ onClick, children, label, danger }: { onClick: () => void; children: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-12 flex items-center justify-center text-fg-muted transition relative z-10
        ${danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-bg-elev hover:text-fg'}`}
    >
      {children}
    </button>
  );
}
