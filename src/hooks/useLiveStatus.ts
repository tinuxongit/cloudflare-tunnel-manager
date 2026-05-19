import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/ipc';

export function useLiveStatus(enabled: boolean) {
  const { pages, setStatus } = useStore();
  useEffect(() => {
    if (!enabled) return;
    const tunnelIds = Array.from(new Set(pages.filter(p => p.enabled).map(p => p.tunnel_uuid)));
    if (tunnelIds.length === 0) return;
    let cancelled = false;
    async function tick() {
      const results = await Promise.all(tunnelIds.map(uuid =>
        api.getStatus(uuid).then(s => [uuid, s] as const).catch(() => [uuid, null] as const)
      ));
      if (cancelled) return;
      for (const [uuid, s] of results) if (s) setStatus(uuid, s);
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, pages, setStatus]);
}
