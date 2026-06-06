export function Loading({ label }: { label: string }) {
  return <div className="text-sm text-fg-muted py-12 text-center">{label}</div>;
}

export function Empty({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="text-sm text-fg-muted py-12 text-center bg-bg-elev border border-border rounded-md">
      <div className="text-fg">{label}</div>
      {hint && <div className="text-[11px] text-fg-dim mt-2">{hint}</div>}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div className="text-[11px] font-mono text-red-300 bg-red-950/20 border border-red-900/50 rounded p-3 whitespace-pre-wrap break-words">
      {text}
    </div>
  );
}
