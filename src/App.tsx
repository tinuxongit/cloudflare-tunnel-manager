import { useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { SetupBanner } from '@/components/SetupBanner';
import { useStore } from '@/lib/store';
import { PagesView } from '@/pages/PagesView';
import { TunnelsView } from '@/pages/TunnelsView';
import { LogsView } from '@/pages/LogsView';
import { HealthView } from '@/pages/HealthView';
import { SettingsView } from '@/pages/SettingsView';

export default function App() {
  const { view, refreshSystem, refreshPages, refreshTunnels, refreshSettings } = useStore();

  useEffect(() => {
    refreshSystem();
    refreshSettings();
    refreshPages();
    refreshTunnels();
  }, []);

  return (
    <div className="min-h-screen flex bg-bg text-fg">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <SetupBanner />
        {view === 'pages' && <PagesView />}
        {view === 'tunnels' && <TunnelsView />}
        {view === 'logs' && <LogsView />}
        {view === 'health' && <HealthView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
