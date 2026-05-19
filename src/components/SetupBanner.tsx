import { useStore } from '@/lib/store';

export function SetupBanner() {
  const { cloudflared } = useStore();
  if (!cloudflared) return null;
  const missing = !cloudflared.path || cloudflared.path === 'cloudflared';
  if (!missing && cloudflared.logged_in) return null;
  return (
    <div className="bg-yellow-950/40 border-b border-yellow-700/40 px-7 py-4 text-sm">
      {missing && <div>⚠ cloudflared not found on PATH. Install from <span className="font-mono">https://developers.cloudflare.com/cloudflared</span> or set the path in Settings.</div>}
      {!cloudflared.logged_in && <div>⚠ Not logged in to Cloudflare. Run <code className="font-mono bg-bg px-1 rounded">cloudflared tunnel login</code> in a terminal.</div>}
    </div>
  );
}
