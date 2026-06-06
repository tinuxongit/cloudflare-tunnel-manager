import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '@/lib/ipc';
import { useDeployTerminal } from '@/lib/deployTerminal';
import { useStore } from '@/lib/store';
import type { ToolStatus } from '@/lib/types';

export function SetupSection() {
  // Tool detection is cached in the store (probed once at app boot). Without
  // the cache, navigating to Settings re-runs `--version` on every tool, which
  // spawns subprocesses and stalls the navigation by hundreds of ms on Windows.
  const { setupTools: tools, setupError: err, refreshSetup } = useStore();
  const [installing, setInstalling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const startTerminal = useDeployTerminal((s) => s.start);

  async function reload() {
    setRefreshing(true);
    try { await refreshSetup(); } finally { setRefreshing(false); }
  }

  async function install(t: ToolStatus) {
    if (!t.install) return;
    if (t.install.kind === 'manual') {
      openUrl(t.install.target).catch(() => {});
      return;
    }
    setInstalling(t.id);
    try {
      const eventId = await api.installTool(t.id);
      await startTerminal(`Installing ${t.label}`, eventId);
      // Re-detect after a moment so the version + status refresh.
      setTimeout(() => { reload(); setInstalling(null); }, 4000);
    } catch (e: any) {
      alert(`${t.label}: ${e?.message ?? String(e)}`);
      setInstalling(null);
    }
  }

  const missingEssential = tools?.some(t => t.importance === 'essential' && !t.installed) ?? false;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold">Setup</h3>
          <p className="text-[11px] text-fg-dim mt-0.5">Tools Cloudflare Studio needs to build and deploy projects.</p>
        </div>
        <button onClick={reload} disabled={refreshing} className="text-[11px] text-fg-muted hover:text-fg disabled:opacity-40">
          {refreshing ? '…checking' : '↻ Re-check'}
        </button>
      </div>

      {missingEssential && (
        <div className="text-[11px] bg-red-950/30 border border-red-900/50 rounded p-3 text-red-200">
          Some essential tools are missing. Install them below before creating new projects.
        </div>
      )}

      {err && (
        <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-2">{err}</div>
      )}

      {!tools ? (
        <div className="text-fg-dim text-sm">Detecting…</div>
      ) : (
        <ul className="space-y-1">
          {tools.map(t => {
            // pnpm install runs `npm install -g pnpm` which needs Node first.
            const nodeMissing = tools.some(x => x.id === 'node' && !x.installed);
            const blocked = t.id === 'pnpm' && nodeMissing;
            return (
              <ToolRow key={t.id} t={t} busy={installing === t.id}
                onInstall={() => install(t)}
                blockedBy={blocked ? 'Install Node first.' : null} />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ToolRow({ t, busy, onInstall, blockedBy }: { t: ToolStatus; busy: boolean; onInstall: () => void; blockedBy: string | null }) {
  const badge = badgeFor(t);
  return (
    <li className="flex items-center justify-between gap-3 bg-bg-elev border border-border rounded p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-fg text-sm">{t.label}</span>
          <span className={`text-[10px] uppercase tracking-wider font-mono ${badge.cls}`}>{badge.text}</span>
          {t.version && <span className="text-[10px] font-mono text-fg-dim truncate">{t.version}</span>}
        </div>
        <div className="text-[11px] text-fg-dim mt-0.5">
          {t.required_for}
          {blockedBy && <span className="text-yellow-300 ml-1">· {blockedBy}</span>}
        </div>
      </div>
      <div className="flex-shrink-0">
        {t.installed ? (
          <span className="text-[11px] text-green-300 font-mono">✓ installed</span>
        ) : t.install ? (
          <button onClick={onInstall} disabled={busy || !!blockedBy}
            title={blockedBy ?? undefined}
            className="text-[11px] px-3 py-1.5 bg-gradient-to-b from-fg to-fg-muted text-bg rounded font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Installing…' : t.install.kind === 'manual' ? 'Download…' : 'Install'}
          </button>
        ) : (
          <span className="text-[11px] text-fg-dim font-mono">manual</span>
        )}
      </div>
    </li>
  );
}

function badgeFor(t: ToolStatus): { text: string; cls: string } {
  if (t.importance === 'essential') return { text: 'essential', cls: t.installed ? 'text-fg-dim' : 'text-red-300' };
  if (t.importance === 'recommended') return { text: 'recommended', cls: t.installed ? 'text-fg-dim' : 'text-yellow-300' };
  return { text: 'optional', cls: 'text-fg-dim' };
}
