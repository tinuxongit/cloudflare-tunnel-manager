import { useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { SetupBanner } from '@/components/SetupBanner';
import { TitleBar } from '@/components/TitleBar';
import { useStore } from '@/lib/store';
import { PagesView } from '@/pages/PagesView';
import { TunnelsView } from '@/pages/TunnelsView';
import { LogsView } from '@/pages/LogsView';
import { HealthView } from '@/pages/HealthView';
import { SettingsView } from '@/pages/SettingsView';

export default function App() {
  const { view, refreshSystem, refreshPages, refreshTunnels, refreshSettings, refreshTokenState, refreshZones } = useStore();

  useEffect(() => {
    refreshSystem();
    refreshSettings();
    refreshPages();
    refreshTunnels();
    (async () => {
      await refreshTokenState();
      if (useStore.getState().hasToken) await refreshZones();
    })();
  }, []);

  return (
    <div className="h-screen flex flex-col bg-bg text-fg overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-auto">
          <SetupBanner />
          {view === 'pages' && <PagesView />}
          {view === 'tunnels' && <TunnelsView />}
          {view === 'logs' && <LogsView />}
          {view === 'health' && <HealthView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}
