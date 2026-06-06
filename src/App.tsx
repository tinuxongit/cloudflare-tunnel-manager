import { useEffect } from 'react';
import { api } from '@/lib/ipc';
import { getConnection } from '@/lib/connection';
import { Sidebar } from '@/components/Sidebar';
import { SetupBanner } from '@/components/SetupBanner';
import { TitleBar } from '@/components/TitleBar';
import { useStore } from '@/lib/store';
import { PagesView } from '@/pages/PagesView';
import { TunnelsView } from '@/pages/TunnelsView';
import { LogsView } from '@/pages/LogsView';
import { HealthView } from '@/pages/HealthView';
import { SettingsView } from '@/pages/SettingsView';
import { WorkersView } from '@/pages/WorkersView';
import { D1View } from '@/pages/D1View';
import { DNSView } from '@/pages/DNSView';
import { CfPagesView } from '@/pages/CfPagesView';
import { ProjectsView } from '@/pages/ProjectsView';
import { R2View } from '@/pages/R2View';
import { DashboardView } from '@/pages/DashboardView';
import { FilesView } from '@/pages/FilesView';
import { DeployTerminal } from '@/components/DeployTerminal';
import { ConfirmProvider } from '@/components/ConfirmDialog';

export default function App() {
  const { view, refreshSystem, refreshPages, refreshTunnels, refreshSettings, refreshTokenState, refreshZones, refreshSetup, realtimeConnect, realtimeDisconnect } = useStore();

  useEffect(() => {
    refreshSystem();
    refreshSettings();
    refreshPages();
    refreshTunnels();
    refreshSetup();
    (async () => {
      await refreshTokenState();
      if (useStore.getState().hasToken) await refreshZones();
      // Defensive: in remote mode, if the laptop has a CF token but the
      // server doesn't (or its keyring lost it), the server's CF calls all
      // return 500. Re-push the laptop's saved credentials best-effort on
      // every boot so a stale-credential-server self-heals on next launch.
      if (getConnection().mode === 'remote' && useStore.getState().hasToken) {
        try { await api.pushCredentialsToConnector(); }
        catch (e) { console.warn('[boot] credentials auto-push failed', e); }
      }
    })();
    // Realtime SSE — in remote mode, opens a single long-lived /events
    // stream and refetches affected slices when the server pushes events.
    // In local mode this is a no-op (Tauri events would be the equivalent
    // and the current code refreshes on demand).
    realtimeConnect();
    return () => realtimeDisconnect();
  }, []);

  return (
    <ConfirmProvider>
    <div className="h-screen flex flex-col bg-bg text-fg overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-auto">
          <SetupBanner />
          <div key={view} className="view-enter">
            {view === 'dashboard' && <DashboardView />}
            {view === 'projects' && <ProjectsView />}
            {view === 'routes' && <PagesView />}
            {view === 'tunnels' && <TunnelsView />}
            {view === 'workers' && <WorkersView />}
            {view === 'd1' && <D1View />}
            {view === 'r2' && <R2View />}
            {view === 'dns' && <DNSView />}
            {view === 'cf-pages' && <CfPagesView />}
            {view === 'files' && <FilesView />}
            {view === 'logs' && <LogsView />}
            {view === 'health' && <HealthView />}
            {view === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
      <DeployTerminal />
    </div>
    </ConfirmProvider>
  );
}
