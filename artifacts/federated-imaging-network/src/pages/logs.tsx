import { useMemo, useState } from 'react';
import { FileClock, MessageCircleQuestion, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { getGetNetworkEventsQueryKey, useAskAboutEvent, useGetNetworkEvents, type ActivityEvent } from '@workspace/api-client-react';
import { PageFrame, Panel, QueryState } from '@/components/app-shell';
import { useSelectedTrackId } from '@/hooks/use-track';
import { useToast } from '@/hooks/use-toast';
import { eventTone, formatDate } from '@/lib/federation';

const eventFilters = ['all', 'training', 'privacy', 'system', 'agent'];

export default function Logs() {
  const trackId = useSelectedTrackId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const events = useGetNetworkEvents({ track: trackId, limit: 100 }, { query: { queryKey: getGetNetworkEventsQueryKey({ track: trackId, limit: 100 }), enabled: Boolean(trackId) } });
  const filtered = useMemo(() => (events.data ?? []).filter((event) => {
    const matchesFilter = filter === 'all' || event.type.toLowerCase().includes(filter);
    const haystack = `${event.title} ${event.detail} ${event.actor} ${event.nodeId ?? ''}`.toLowerCase();
    return matchesFilter && haystack.includes(query.toLowerCase());
  }), [events.data, filter, query]);

  return (
    <PageFrame eyebrow="Forensics / activity stream" title="Activity logs" description="Searchable event receipts across the federation. Use the log as the primary source for reconstructing a round, a privacy check, or an agent action." actions={<div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"><FileClock size={14} className="text-primary" /> 100 event window</div>}>
      <QueryState loading={events.isLoading} error={events.isError} empty={!trackId || !filtered.length} onRetry={() => void events.refetch()}>
        <Panel>
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <label className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event, actor, node…" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs outline-none ring-primary transition focus:ring-2" data-testid="input-search-logs" /></label>
            <div className="flex items-center gap-2 overflow-x-auto"><SlidersHorizontal size={14} className="shrink-0 text-muted-foreground" />{eventFilters.map((item) => <button type="button" key={item} onClick={() => setFilter(item)} className={`shrink-0 rounded-md px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[.08em] ${filter === item ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-${item}`}>{item}</button>)}</div>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((event) => <EventRow key={event.id} event={event} />)}
          </div>
        </Panel>
      </QueryState>
    </PageFrame>
  );
}

interface QaTurn {
  question: string;
  answer: string;
}

function EventRow({ event }: { event: ActivityEvent }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const ask = useAskAboutEvent();

  const submit = () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    ask.mutate(
      { eventId: event.id, data: { question: trimmed } },
      {
        onSuccess: (result) => {
          setTurns((prev) => [...prev, { question: trimmed, answer: result.answer }]);
          setQuestion('');
        },
        onError: (error) => {
          toast({ title: 'Could not get an answer', description: error instanceof Error ? error.message : 'The Federation Agent call failed.', variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/30 sm:px-5" data-testid={`event-row-${event.id}`}>
      <div className="flex gap-3">
        <div className="flex w-[66px] shrink-0 flex-col items-end gap-1"><span className="font-mono text-[10px] text-muted-foreground">{formatDate(event.timestamp)}</span><span className="font-mono text-[9px] text-muted-foreground/60">R{event.round}</span></div>
        <div className="relative mt-1 flex w-3 justify-center"><span className={`h-2.5 w-2.5 rounded-full ring-4 ring-card ${eventTone(event).split(' ')[0].replace('text-', 'bg-')}`} /><span className="absolute top-3 h-full w-px bg-border group-last:hidden" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold">{event.title}</p><span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[.08em] ${eventTone(event)}`}>{event.severity}</span></div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{event.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground/70">
            <span>Actor / {event.actor}</span><span>Type / {event.type}</span>{event.nodeId && <span>Node / {event.nodeId}</span>}
            <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 normal-case tracking-normal text-primary hover:underline" data-testid={`button-ask-${event.id}`}><MessageCircleQuestion size={11} />{expanded ? 'Hide Q&A' : 'Ask about this event'}</button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="ml-[81px] space-y-3 rounded-md border border-border bg-muted/30 p-3">
          {turns.map((turn, index) => (
            <div key={index} className="space-y-1.5 text-xs">
              <p className="font-semibold text-foreground">{turn.question}</p>
              <p className="flex gap-1.5 leading-5 text-muted-foreground"><Sparkles size={12} className="mt-0.5 shrink-0 text-primary" />{turn.answer}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !ask.isPending) submit(); }}
              placeholder="e.g. why did this happen?"
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-xs outline-none ring-primary transition focus:ring-2"
              data-testid={`input-question-${event.id}`}
            />
            <button type="button" disabled={ask.isPending || !question.trim()} onClick={submit} className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:cursor-wait disabled:opacity-60" data-testid={`button-submit-question-${event.id}`}>
              {ask.isPending ? 'Asking…' : 'Ask'}
            </button>
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground/70">Answers are grounded in this event and live track telemetry, generated on demand — not stored as part of the audit trail.</p>
        </div>
      )}
    </div>
  );
}
