import { useStore } from '@/lib/store';

const items = [
  { id: 'pages' as const,    label: 'Pages' },
  { id: 'tunnels' as const,  label: 'Tunnels' },
  { id: 'logs' as const,     label: 'Logs' },
  { id: 'health' as const,   label: 'Health' },
  { id: 'settings' as const, label: 'Settings' },
];

export function Sidebar() {
  const { view, setView, cloudflared } = useStore();
  return (
    <aside className="w-[230px] flex flex-col bg-gradient-to-b from-side to-side-alt border-r border-border-strong shadow-[4px_0_12px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-3 px-4 pt-6 pb-5 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fg to-fg-muted text-bg flex items-center justify-center font-bold">⌘</div>
        <div>
          <div className="text-sm font-semibold">Tunnel Manager</div>
          <div className="text-[10px] text-fg-dim font-mono">v0.1.0</div>
        </div>
      </div>

      <nav className="flex flex-col gap-px px-2 py-3 flex-1">
        <div className="text-[10px] uppercase tracking-widest text-fg-dim font-mono px-3 pt-2 pb-1">Workspace</div>
        {items.map(it => (
          <button key={it.id}
            onClick={() => setView(it.id)}
            className={`text-left text-sm px-3 py-2 rounded-md transition
              ${view === it.id
                ? 'bg-gradient-to-b from-zinc-700/40 to-zinc-800/40 text-fg border border-zinc-700/60 shadow-inner'
                : 'text-fg-muted hover:bg-zinc-800/40 hover:text-fg'}`}>
            {it.label}
          </button>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-border text-[10px] font-mono text-fg-dim flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg shadow-[0_0_8px_rgba(255,255,255,0.5)]"></span>
        {cloudflared ? cloudflared.version : 'cloudflared …'}
      </div>
    </aside>
  );
}
