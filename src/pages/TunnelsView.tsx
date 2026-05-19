import { useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';

export function TunnelsView() {
  const { tunnels, refreshTunnels } = useStore();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try { await api.createTunnel(name); setName(''); await refreshTunnels(); }
    finally { setBusy(false); }
  }

  async function remove(uuid: string) {
    if (!confirm(`Delete tunnel ${uuid}? This cannot be undone.`)) return;
    await api.deleteTunnel(uuid);
    await refreshTunnels();
  }

  return (
    <div>
      <div className="px-7 py-5 border-b border-border-subtle flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tunnels</h2>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="new tunnel name"
            className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono" />
          <button disabled={!name || busy} onClick={create}
            className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
            + Create
          </button>
        </div>
      </div>

      <div className="p-4">
        {tunnels.map(t => (
          <div key={t.uuid} className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3 border border-border-subtle rounded-lg mb-2">
            <div>
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-[11px] font-mono text-fg-muted">{t.uuid}</div>
            </div>
            {t.managed && <span className="text-[10px] uppercase font-mono text-fg-dim border border-border rounded px-2 py-0.5">managed</span>}
            <button onClick={() => remove(t.uuid)} className="text-fg-muted text-xs hover:text-red-400">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
