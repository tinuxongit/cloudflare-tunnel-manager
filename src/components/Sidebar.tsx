import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { getConnection } from '@/lib/connection';

type View =
  | 'dashboard' | 'projects'
  | 'routes' | 'tunnels'
  | 'workers' | 'd1' | 'r2' | 'dns' | 'cf-pages'
  | 'files'
  | 'logs' | 'health' | 'settings';

type Leaf  = { kind: 'leaf'; id: View; label: string; icon: IconName };
type Child = { id: View; label: string; icon: IconName };
type Group = { kind: 'group'; id: string; label: string; icon: IconName; children: Child[] };
type Item  = Leaf | Group;

const NAV: Item[] = [
  { kind: 'leaf',  id: 'dashboard', label: 'Dashboard',   icon: 'grid' },
  { kind: 'leaf',  id: 'projects',  label: 'Projects',    icon: 'projects' },
  { kind: 'leaf',  id: 'files',     label: 'Files',       icon: 'folder' },
  { kind: 'group', id: 'edge',      label: 'Workers & Pages', icon: 'book', children: [
      { id: 'workers',  label: 'Workers', icon: 'bolt'     },
      { id: 'cf-pages', label: 'Pages',   icon: 'page'     },
      { id: 'd1',       label: 'D1',      icon: 'database' },
      { id: 'r2',       label: 'R2',      icon: 'bucket'   },
      { id: 'dns',      label: 'DNS',     icon: 'globe'    },
  ]},
  { kind: 'group', id: 'local',     label: 'Local hosting',   icon: 'house', children: [
      { id: 'routes',  label: 'Routes',  icon: 'route' },
      { id: 'tunnels', label: 'Tunnels', icon: 'arch'  },
  ]},
  { kind: 'leaf',  id: 'logs',         label: 'Logs',           icon: 'logs' },
  { kind: 'leaf',  id: 'health',       label: 'Health',         icon: 'health' },
  { kind: 'leaf',  id: 'settings',     label: 'Settings',       icon: 'settings' },
];

const VIEW_TO_GROUP: Record<string, string> = {
  workers: 'edge', 'cf-pages': 'edge', d1: 'edge', r2: 'edge', dns: 'edge',
  routes: 'local', tunnels: 'local',
};

type Flyout = { groupId: string; top: number; left: number };

export function Sidebar() {
  const { view, setView, sidebarCollapsed, setSidebarCollapsed } = useStore();
  const collapsed = sidebarCollapsed;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    edge: VIEW_TO_GROUP[view] === 'edge',
    local: VIEW_TO_GROUP[view] === 'local',
  }));
  const [flyout, setFlyout] = useState<Flyout | null>(null);

  // Auto-open the group that contains the active view (only matters when expanded).
  useEffect(() => {
    const g = VIEW_TO_GROUP[view];
    if (g) setOpenGroups(s => (s[g] ? s : { ...s, [g]: true }));
  }, [view]);

  // Close the collapsed-mode flyout when the sidebar expands.
  useEffect(() => { if (!collapsed) setFlyout(null); }, [collapsed]);

  function openFlyoutAt(groupId: string, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    setFlyout({ groupId, top: rect.top, left: rect.right + 8 });
  }

  return (
    <>
      <aside
        style={{ width: collapsed ? 64 : 260 }}
        className="flex flex-col bg-[linear-gradient(180deg,#10141a,#0b0d11)] border-r border-border-strong shadow-[8px_0_32px_rgba(0,0,0,0.26)] overflow-hidden transition-[width] duration-300 ease-out">

        {/* Header */}
        <div className={`pt-4 pb-1 ${collapsed ? 'px-0' : 'px-4'}`}>
          <div className={`text-[11px] uppercase tracking-wider text-fg-muted font-bold transition-opacity duration-150
            ${collapsed ? 'opacity-0 pointer-events-none h-0' : 'opacity-100'}`}>
            Cloudflare
          </div>
        </div>

        {/* Nav */}
        <nav className={`flex flex-col gap-px flex-1 overflow-y-auto overflow-x-hidden pt-1 pb-2
          ${collapsed ? 'px-2 items-center' : 'px-2'}`}>
          {NAV.map((item, idx) => {
            const sep = idx > 0 ? <NavDivider collapsed={collapsed} /> : null;
            if (item.kind === 'leaf') {
              const active = view === item.id;
              return (
                <Fragment key={item.id}>
                  {sep}
                  {collapsed ? (
                    <button
                      title={item.label}
                      onClick={() => setView(item.id)}
                      className={`w-10 h-10 flex items-center justify-center rounded-md transition relative
                        ${active
                          ? 'bg-zinc-700/40 text-fg before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-orange-500'
                          : 'text-fg-muted hover:text-fg hover:bg-zinc-800/40'}`}>
                      <Icon name={item.icon} />
                    </button>
                  ) : (
                    <button
                      onClick={() => setView(item.id)}
                      className={`w-full flex items-center gap-2.5 text-left text-sm px-3 py-2 rounded-md transition relative
                        ${active
                          ? 'bg-gradient-to-r from-zinc-700/40 to-zinc-800/30 text-fg border border-zinc-700/60 shadow-inner before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-orange-500'
                          : 'text-fg-muted hover:bg-zinc-800/40 hover:text-fg border border-transparent'}`}>
                      <Icon name={item.icon} className="text-fg-dim shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )}
                </Fragment>
              );
            }
            // Group
            const open = !!openGroups[item.id];
            const childActive = item.children.some(c => c.id === view);
            const flyoutOpen = flyout?.groupId === item.id;

            if (collapsed) {
              return (
                <Fragment key={item.id}>
                  {sep}
                  <button
                    title={item.label}
                    onClick={(e) => {
                      if (flyoutOpen) setFlyout(null);
                      else openFlyoutAt(item.id, e.currentTarget);
                    }}
                    className={`w-10 h-10 flex items-center justify-center rounded-md transition relative
                      ${childActive || flyoutOpen
                        ? 'bg-zinc-700/40 text-fg before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-orange-500'
                        : 'text-fg-muted hover:text-fg hover:bg-zinc-800/40'}`}>
                    <Icon name={item.icon} />
                  </button>
                </Fragment>
              );
            }
            return (
              <Fragment key={item.id}>
                {sep}
                <div className="mb-px">
                <button
                  onClick={() => setOpenGroups(s => ({ ...s, [item.id]: !s[item.id] }))}
                  className={`w-full flex items-center gap-2.5 text-left text-sm px-3 py-2 rounded-md transition border
                    ${childActive
                      ? 'text-fg border-zinc-700/60 bg-zinc-800/30'
                      : 'text-fg-muted border-transparent hover:bg-zinc-800/40 hover:text-fg'}`}>
                  <Icon name={item.icon} className="text-fg-dim shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <Icon name="chevron-down"
                    className={`text-fg-dim shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
                </button>
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out
                    ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  aria-hidden={!open}>
                  <div className="overflow-hidden">
                    <div className="ml-[18px] mt-px py-1 pl-3 relative">
                      {/* Vertical guide line */}
                      <div className="absolute left-0 top-2 bottom-2 w-px bg-zinc-600/70" aria-hidden />
                      {item.children.map((c, i) => {
                        const active = view === c.id;
                        return (
                          <div key={c.id} className="relative">
                            {/* Horizontal connector stub from the guide line to the button */}
                            <span className="absolute -left-3 top-1/2 w-3 h-px bg-zinc-600/70" aria-hidden />
                            {/* Separator between consecutive children */}
                            {i > 0 && (
                              <div className="flex items-center justify-center" aria-hidden>
                                <div className="h-px w-[80%] bg-gradient-to-r from-transparent via-zinc-500/35 to-transparent" />
                              </div>
                            )}
                            <button
                              tabIndex={open ? 0 : -1}
                              onClick={() => setView(c.id)}
                              className={`w-full flex items-center gap-2 text-left text-[13px] px-2.5 py-1.5 rounded-md transition relative
                                ${active
                                  ? 'bg-zinc-700/40 text-fg before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-orange-500'
                                  : 'text-fg-muted hover:bg-zinc-800/40 hover:text-fg'}`}>
                              <Icon name={c.icon} className="text-fg-dim shrink-0" />
                              <span className="truncate">{c.label}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                </div>
              </Fragment>
            );
          })}
        </nav>

        {/* Footer */}
        {collapsed ? (
          <button onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar"
            className="h-10 flex items-center justify-center border-t border-border text-fg-dim hover:text-fg hover:bg-zinc-800/40 transition">
            <Icon name="chevron-right" />
          </button>
        ) : (
          <div className="border-t border-border px-3 py-3 space-y-2">
            <StatusChip />
            <AccountFooter />
            <button onClick={() => setSidebarCollapsed(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-fg-dim hover:text-fg hover:bg-zinc-800/40 rounded-md transition">
              <Icon name="chevron-left" />
              <span>Collapse</span>
            </button>
          </div>
        )}
      </aside>

      {/* Collapsed-mode flyout popover */}
      {flyout && (() => {
        const group = NAV.find(i => i.kind === 'group' && i.id === flyout.groupId) as Group | undefined;
        if (!group) return null;
        return (
          <GroupFlyout
            group={group}
            top={flyout.top}
            left={flyout.left}
            currentView={view}
            onPick={(id) => { setView(id); setFlyout(null); }}
            onClose={() => setFlyout(null)} />
        );
      })()}
    </>
  );
}

// ── Dividers ─────────────────────────────────────────────────────────────

function NavDivider({ collapsed }: { collapsed: boolean }) {
  // A thin gradient hairline that fades at both ends. No center accent — the
  // gradient does the "modern" work on its own.
  return (
    <div className="flex items-center justify-center select-none" aria-hidden>
      <div className={`h-px bg-gradient-to-r from-transparent via-zinc-500/40 to-transparent ${collapsed ? 'w-7' : 'w-[88%]'}`} />
    </div>
  );
}

// ── Flyout ───────────────────────────────────────────────────────────────

function GroupFlyout({
  group, top, left, currentView, onPick, onClose,
}: {
  group: Group;
  top: number;
  left: number;
  currentView: View;
  onPick: (id: View) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Start hidden so the entrance animation has somewhere to go; flip to shown
  // after first paint via rAF — useEffect runs before the browser repaints and
  // would skip the transition without it.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Outside-click + Escape close. Capture handles the case where the click
  // also lands on the original group icon — without it, the toggle re-opens.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ top, left }}
      className={`fixed z-50 min-w-[180px] bg-[linear-gradient(180deg,#161a21,#0e1116)] border border-border-strong rounded-lg shadow-[0_18px_60px_rgba(0,0,0,0.55)] py-1.5
        transition-[opacity,transform] duration-200 ease-out origin-left
        ${shown ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}`}>
      <div className="px-3 pt-1 pb-1.5 text-[10px] uppercase tracking-[0.18em] text-fg-dim font-semibold">
        {group.label}
      </div>
      <div className="px-1">
        {group.children.map((c, i) => {
          const active = currentView === c.id;
          return (
            <div key={c.id}>
              {i > 0 && (
                <div className="flex items-center justify-center" aria-hidden>
                  <div className="h-px w-[80%] bg-gradient-to-r from-transparent via-zinc-500/35 to-transparent" />
                </div>
              )}
              <button
                onClick={() => onPick(c.id)}
                className={`w-full flex items-center gap-2 text-left text-[13px] px-2.5 py-1.5 rounded-md transition
                  ${active ? 'bg-zinc-700/40 text-fg' : 'text-fg-muted hover:bg-zinc-800/40 hover:text-fg'}`}>
                <Icon name={c.icon} className="text-fg-dim shrink-0" />
                <span className="truncate">{c.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────

/// Returns true when the user has switched the app to Remote mode but
/// hasn't paired with a server yet — every CF API call will fail in this
/// state, so the sidebar chips should reflect "not connected" instead of
/// "no token / no account" (both of which read like a configuration bug).
function isRemoteUnpaired() {
  const c = getConnection();
  return c.mode === 'remote' && (!c.remote || !c.remote.token);
}

function StatusChip() {
  const { hasToken, zones } = useStore();

  if (isRemoteUnpaired()) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-strong bg-bg/55">
        <span className="w-2 h-2 rounded-full shrink-0 bg-zinc-600" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-fg leading-tight font-medium">Not paired</div>
          <div className="text-[11px] text-fg-dim leading-tight mt-0.5">Pair a server in Settings</div>
        </div>
      </div>
    );
  }

  // We treat Cloudflare as reachable if a token is set AND we successfully
  // listed at least one zone — that's the same call any feature view makes,
  // so it's a real liveness signal, not just "config exists".
  const ok = hasToken && zones.length > 0;
  const dotCls = ok
    ? 'bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.55)]'
    : hasToken ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.45)]' : 'bg-zinc-600';
  const label = ok ? 'Connected' : hasToken ? 'Unreachable' : 'No token';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-strong bg-bg/55">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-fg leading-tight font-medium">{label}</div>
        <div className="text-[11px] text-fg-dim leading-tight mt-0.5">Cloudflare API</div>
      </div>
    </div>
  );
}

function AccountFooter() {
  const { zones, setView } = useStore();
  const unpaired = isRemoteUnpaired();
  const accountName = useMemo(() => {
    const names = Array.from(new Set(zones.map(z => z.account_name).filter(Boolean))) as string[];
    return names[0] ?? null;
  }, [zones]);

  // In remote-unpaired mode the user has no remote account context yet — the
  // local CF token (if any) belongs to the laptop, not the server they're
  // trying to control. Don't pretend we have an account label.
  const label = unpaired ? 'No server paired' : (accountName ?? 'No account');
  const sub = unpaired ? 'Tap to pair one' : 'Account';
  const initial = (unpaired ? '?' : label).charAt(0).toUpperCase();

  return (
    <button onClick={() => setView('settings')}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-strong bg-bg/55 hover:bg-zinc-800/40 hover:border-zinc-600/80 transition text-left">
      <span className={`w-7 h-7 rounded-full text-bg text-[12px] flex items-center justify-center font-bold shrink-0
        ${unpaired
          ? 'bg-gradient-to-br from-zinc-500 to-zinc-700 shadow-none text-fg-dim'
          : 'bg-gradient-to-br from-orange-400 to-orange-600 shadow-[0_0_10px_rgba(249,115,22,0.25)]'}`}>
        {initial}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-fg leading-tight font-medium truncate" title={label}>
          {label}
        </div>
        <div className="text-[11px] text-fg-dim leading-tight mt-0.5">{sub}</div>
      </div>
      <Icon name="chevron-up" className="text-fg-dim shrink-0" />
    </button>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────

type IconName =
  | 'grid' | 'projects' | 'book' | 'house' | 'folder'
  | 'logs' | 'health' | 'settings'
  | 'bolt' | 'page' | 'database' | 'bucket' | 'globe'
  | 'route' | 'arch'
  | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'chevron-up';

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const common = `inline-block ${className}`;
  switch (name) {
    case 'grid': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>);
    case 'projects': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
      </svg>);
    case 'folder': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
        <path d="M3 11h18"/>
      </svg>);
    case 'book': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/>
        <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>
      </svg>);
    case 'house': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M3 10.5 12 3l9 7.5"/>
        <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/>
        <path d="M10 21v-6h4v6"/>
      </svg>);
    case 'bolt': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7z"/>
      </svg>);
    case 'page': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
      </svg>);
    case 'database': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <ellipse cx="12" cy="5" rx="8" ry="3"/>
        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/>
        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>
      </svg>);
    case 'bucket': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M4 7h16l-2 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/>
        <path d="M8 7a4 4 0 0 1 8 0"/>
      </svg>);
    case 'globe': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <circle cx="12" cy="12" r="9"/>
        <path d="M3 12h18"/>
        <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>
      </svg>);
    case 'route': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <circle cx="6" cy="19" r="2"/>
        <circle cx="18" cy="5" r="2"/>
        <path d="M8 19h7a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7"/>
      </svg>);
    case 'arch': return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M3 21V11a9 9 0 0 1 18 0v10"/>
        <path d="M3 21h18"/>
        <path d="M9 21v-7a3 3 0 0 1 6 0v7"/>
      </svg>);
    case 'logs': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>
      </svg>);
    case 'health': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>);
    case 'settings': return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>);
    case 'chevron-right': return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}><polyline points="9 18 15 12 9 6"/></svg>);
    case 'chevron-left': return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}><polyline points="15 18 9 12 15 6"/></svg>);
    case 'chevron-down': return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}><polyline points="6 9 12 15 18 9"/></svg>);
    case 'chevron-up': return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}><polyline points="18 15 12 9 6 15"/></svg>);
  }
}
