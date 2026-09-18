import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

export function MetricCard({ label, value, helper, trend, accent = 'primary' }: { label: string; value: string; helper?: string; trend?: 'up' | 'down' | 'flat'; accent?: 'primary' | 'accent' | 'ink' }) {
  const accentClass = accent === 'accent' ? 'text-[hsl(var(--accent-foreground))]' : accent === 'ink' ? 'text-foreground' : 'text-primary';
  const Trend = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-4 shadow-[0_1px_0_hsl(var(--border)/.6)]">
      <p className="mono-label text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className={`font-display text-[26px] font-semibold tracking-[-0.055em] ${accentClass}`}>{value}</p>
        {trend && <Trend size={15} className={trend === 'down' ? 'text-[hsl(var(--destructive))]' : trend === 'up' ? 'text-primary' : 'text-muted-foreground'} />}
      </div>
      {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}