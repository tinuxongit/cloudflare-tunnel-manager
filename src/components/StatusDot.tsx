type Props = { state: 'on' | 'off' | 'starting' | 'error' };
export function StatusDot({ state }: Props) {
  if (state === 'on') {
    return (
      <span className="relative inline-flex items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-fg shadow-[0_0_10px_rgba(255,255,255,0.6)]" />
        <span className="absolute -inset-1 rounded-full border border-white/25 animate-ping" />
      </span>
    );
  }
  if (state === 'starting') {
    return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)] animate-pulse" />;
  }
  if (state === 'error') {
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />;
  }
  return <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />;
}
