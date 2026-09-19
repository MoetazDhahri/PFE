import { Info } from 'lucide-react';
import { Link } from 'wouter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// A small inline "what does this mean" hint for jargon terms (AUROC,
// epsilon, Dirichlet partition, FedAvg, ...). Opens on click rather than a
// pure hover tooltip since it contains an interactive "Learn more" link —
// tooltips are for supplementary text only and close before a click inside
// them can land. Links straight into the Knowledge Center's matching
// concept instead of just defining the term in isolation, so a confused
// reader always has a next step.
export function InfoTip({ definition, conceptId }: { definition: string; conceptId?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            // InfoTip is sometimes nested inside a clickable card/link (see
            // MetricCard) — without this, opening the tip would also
            // trigger that outer navigation.
            event.preventDefault();
            event.stopPropagation();
          }}
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:text-primary focus-visible:text-primary"
          aria-label="What does this mean?"
          data-testid="button-info-tip"
        >
          <Info size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 text-xs"
        side="top"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="leading-4 text-foreground">{definition}</p>
        {conceptId && (
          <Link
            href={`/academy?concept=${conceptId}`}
            className="mt-2 inline-block text-[11px] font-semibold text-primary underline underline-offset-2"
            data-testid={`link-learn-more-${conceptId}`}
          >
            Learn more in the Knowledge Center →
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
