import { useStore } from '@/lib/store';

export function TokenGate({ label }: { label: string }) {
  const { setView } = useStore();
  return (
    <div className="p-7">
      <div className="bg-bg-elev border border-border rounded-md p-8 text-center max-w-md mx-auto">
        <div className="text-fg text-lg font-semibold mb-2">{label} needs an API token</div>
        <div className="text-fg-dim text-sm mb-5">
          Add a Cloudflare API token in Settings. Same token unlocks Workers, D1, DNS, and Pages.
        </div>
        <button onClick={() => setView('settings')}
          className="bg-gradient-to-b from-fg to-fg-muted text-bg rounded-md px-4 py-2 text-sm font-semibold">
          Open Settings
        </button>
      </div>
    </div>
  );
}
