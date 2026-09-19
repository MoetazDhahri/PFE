import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import { Link } from 'wouter';
import { InfoTip } from '@/components/info-tip';

export function MetricCard({
  label,
  value,
  helper,
  trend,
  accent = 'primary',
  href,
  infoTip,
}: {
  label: string;
  value: string;
  helper?: string;
  trend?: 'up' | 'down' | 'flat';
  accent?: 'primary' | 'accent' | 'ink';
  /** Optional — makes the whole card a link, for cards that are really a shortcut to a deeper page. */
  href?: string;
  /** Optional — short jargon definition with a Knowledge Center deep link, shown via an inline (?) icon next to the label. */
  infoTip?: { definition: string; conceptId?: string };
}) {
  const accentClass = accent === 'accent' ? 'text-[hsl(var(--accent-foreground))]' : accent === 'ink' ? 'text-foreground' : 'text-primary';
  const Trend = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;

  const content = (
    <>
      <div className="flex items-center gap-1.5">
        <p className="mono-label text-muted-foreground">{label}</p>
        {infoTip && <InfoTip definition={infoTip.definition} conceptId={infoTip.conceptId} />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className={`font-display text-[26px] font-semibold tracking-[-0.055em] ${accentClass}`}>{value}</p>
        {href ? <ChevronRight size={15} className="text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" /> : trend && <Trend size={15} className={trend === 'down' ? 'text-[hsl(var(--destructive))]' : trend === 'up' ? 'text-primary' : 'text-muted-foreground'} />}
      </div>
      {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="group block rounded-lg border border-card-border bg-card px-4 py-4 shadow-[0_1px_0_hsl(var(--border)/.6)] transition-colors hover:border-primary/40 hover:bg-muted/40" data-testid={`link-metric-card-${label.toLowerCase().replaceAll(' ', '-')}`}>
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-4 shadow-[0_1px_0_hsl(var(--border)/.6)]">
      {content}
    </div>
  );
}