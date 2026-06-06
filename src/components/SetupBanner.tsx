import { useStore } from '@/lib/store';
import { getConnection } from '@/lib/connection';

/**
 * Yellow banner shown at the top of every view when cloudflared isn't on
 * disk locally. Remote mode skips this — the server's cloudflared is
 * auto-downloaded by the connector on first run, so there's no actionable
 * advice we can give from the laptop UI if it's missing.
 */
export function SetupBanner() {
  const { cloudflared } = useStore();
  if (!cloudflared) return null;
  if (getConnection().mode === 'remote') return null;

  const missing = !cloudflared.path || cloudflared.path === 'cloudflared';
  if (!missing) return null;

  return (
    <div className="bg-yellow-950/40 border-b border-yellow-700/40 px-7 py-4 text-sm">
      <div>
        ⚠ cloudflared not found on PATH. Install from{' '}
        <span className="font-mono">https://developers.cloudflare.com/cloudflared</span> or set the
        path in Settings.
      </div>
    </div>
  );
}
