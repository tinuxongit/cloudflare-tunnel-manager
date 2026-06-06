import type { ReactNode } from 'react';

export function PageShell({ children, maxWidth = '1360px' }: { children: ReactNode; maxWidth?: string }) {
  return (
    <div className="min-h-full">
      <div className="px-9 py-7 space-y-5" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title, subtitle, actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-6 border-b border-border-subtle pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 items-center flex-wrap">{actions}</div>}
    </header>
  );
}
