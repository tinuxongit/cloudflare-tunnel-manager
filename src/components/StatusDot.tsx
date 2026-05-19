type Props = { state: 'on' | 'off' };
export function StatusDot({ state }: Props) {
  if (state === 'on') {
    return (
      <span className="relative inline-flex items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-fg shadow-[0_0_10px_rgba(255,255,255,0.6)]" />
        <span className="absolute -inset-1 rounded-full border border-white/25 animate-ping" />
      </span>
    );
  }
  return <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />;
}
