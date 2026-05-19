import { useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { useStore } from '@/lib/store';
import { PagesView } from '@/pages/PagesView';

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
        {view === 'pages' && <PagesView />}
        {view !== 'pages' && (
          <div className="p-8 text-fg-dim">View "{view}" coming soon.</div>
        )}
      </main>
    </div>
  );
}
