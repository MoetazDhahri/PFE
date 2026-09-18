import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, BrainCircuit, Check, CheckCircle2, ClipboardCheck, Compass, FileSearch, Gauge, History, Sparkles, Target, TrendingUp, X } from 'lucide-react';
import { Link } from 'wouter';
import { getGetAgentActionHistoryQueryKey, getGetAgentAssessmentQueryKey, useGenerateAgentAssessment, useGetAgentActionHistory, useGetAgentAssessment, useResolveAgentAction, type AgentAssessment } from '@workspace/api-client-react';
import { PageFrame, Panel, QueryState, StatusChip } from '@/components/app-shell';
import { useSelectedTrackId } from '@/hooks/use-track';
import { useToast } from '@/hooks/use-toast';
import { formatDate, trackColor } from '@/lib/federation';

export default function Agent() {
  const trackId = useSelectedTrackId();
  const { toast } = useToast();
  const assessment = useGetAgentAssessment({ track: trackId }, { query: { queryKey: getGetAgentAssessmentQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const history = useGetAgentActionHistory({ track: trackId }, { query: { queryKey: getGetAgentActionHistoryQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const resolution = useResolveAgentAction();
  const generation = useGenerateAgentAssessment();
  const item = assessment.data;
  const busy = resolution.isPending;
  const resolve = (decision: 'approved' | 'dismissed') => {
    if (!item) return;
    resolution.mutate(
      { actionId: item.id, data: { decision } },
      {
        onSuccess: () => {
          void assessment.refetch();
          void history.refetch();
        },
      },
    );
  };
  const generate = () => {
    if (!trackId) return;
    generation.mutate(
      { data: { track: trackId } },
      {
        onSuccess: () => {
          void assessment.refetch();
          void history.refetch();
        },
        onError: (error) => {
          toast({ title: 'Could not generate an assessment', description: error instanceof Error ? error.message : 'The Federation Agent call failed.', variant: 'destructive' });
        },
      },
    );
  };

  return (
    <PageFrame eyebrow="AI Federation Agent / explainable action" title="Agent assessment" description="Every significant agent action is recorded as an Action Value Card: action, purpose, evidence, expected value, observed value, risk, confidence, human decision, and outcome — nothing is applied without an explicit approval." actions={<div className="flex flex-wrap gap-2"><button type="button" disabled={generation.isPending || !trackId} onClick={generate} className="inline-flex items-center gap-2 rounded-md bg-foreground px-3.5 py-2.5 text-xs font-semibold text-background transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60" data-testid="button-generate-assessment"><Sparkles size={14} />{generation.isPending ? 'Analyzing…' : 'Ask agent to analyze now'}</button><Link href="/logs" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2.5 text-xs font-semibold hover:bg-muted" data-testid="link-agent-evidence">Inspect supporting logs <ArrowRight size={14} /></Link></div>}>
      <QueryState loading={assessment.isLoading} error={assessment.isError} empty={!trackId || !item} onRetry={() => void assessment.refetch()}>
        {item && <AgentContent item={item} busy={busy} history={history.data ?? []} historyLoading={history.isLoading} onResolve={resolve} />}
      </QueryState>
    </PageFrame>
  );
}

function AgentContent({ item, busy, history, historyLoading, onResolve }: { item: AgentAssessment; busy: boolean; history: AgentAssessment[]; historyLoading: boolean; onResolve: (decision: 'approved' | 'dismissed') => void }) {
  const color = trackColor(item.trackId);
  const isPending = item.status === 'pending';
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)] fade-up-2">
      <div className="space-y-5">
        <Panel>
          <div className="border-b border-border p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-md" style={{ background: color.tint, color: color.accent }}><BrainCircuit size={18} /></span>
              <span className="mono-label text-primary">Action Value Card / {item.id}</span>
              <StatusChip value={item.status} kind={isPending ? 'warn' : 'good'} />
            </div>
            <h3 className="mt-5 max-w-2xl font-display text-[clamp(24px,3vw,37px)] font-semibold leading-[1.05] tracking-[-.055em]">{item.headline}</h3>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{item.summary}</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">
              <span>Created / {formatDate(item.createdAt)}</span>
              <span>Track / {item.trackId}</span>
              {item.resolvedAt && <span>Resolved / {formatDate(item.resolvedAt)}</span>}
            </div>
          </div>

          <div className="divide-y divide-border">
            <CardRow icon={<Compass size={15} />} label="Purpose"><p className="text-sm leading-6 text-muted-foreground">{item.purpose}</p></CardRow>
            <CardRow icon={<ClipboardCheck size={15} />} label="Recommended action"><p className="text-sm font-semibold leading-6">{item.recommendation}</p></CardRow>
            <CardRow icon={<Target size={15} />} label="Expected value"><p className="text-xs leading-6 text-muted-foreground">{item.expectedValue}</p></CardRow>
            <CardRow icon={<TrendingUp size={15} />} label="Observed value">
              {item.observedValue ? <p className="text-xs leading-6 text-muted-foreground">{item.observedValue}</p> : <p className="text-xs italic leading-6 text-muted-foreground/70">Not yet available — recorded once a human resolves this recommendation.</p>}
            </CardRow>
          </div>

          <div className="bg-muted/30 p-5 sm:p-7">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.1em] text-primary"><ClipboardCheck size={14} /> Human decision</div>
            {isPending ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button type="button" disabled={busy} onClick={() => onResolve('approved')} className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-xs font-semibold text-background disabled:cursor-wait disabled:opacity-60" data-testid="button-approve-agent"><Check size={14} />{busy ? 'Recording…' : 'Approve recommendation'}</button>
                <button type="button" disabled={busy} onClick={() => onResolve('dismissed')} className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs font-semibold hover:bg-background disabled:opacity-60" data-testid="button-dismiss-agent"><X size={14} />Dismiss</button>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3.5 py-3 text-xs text-primary"><CheckCircle2 size={15} className="mr-2 inline" />{item.outcome ?? `This recommendation was ${item.status} and the decision is now part of the audit trail.`}</div>
            )}
          </div>
        </Panel>

        <Panel label="Evidence chain" title="What the agent used">
          <div className="divide-y divide-border">{item.evidence.map((evidence, index) => <div key={`${evidence}-${index}`} className="flex gap-3 px-5 py-4"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">{String(index + 1).padStart(2, '0')}</span><p className="text-xs leading-5 text-muted-foreground">{evidence}</p></div>)}</div>
        </Panel>

        <Panel label="Action history" title="Past resolved actions" action={<span className="mono-label text-muted-foreground">{history.length} recorded</span>}>
          {historyLoading ? (
            <div className="p-7 text-sm text-muted-foreground">Loading history…</div>
          ) : history.length ? (
            <div className="divide-y divide-border">
              {history.map((entry) => (
                <div key={entry.id} className="flex gap-3 px-5 py-4" data-testid={`row-history-${entry.id}`}>
                  <History size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{entry.headline}</p>
                      <StatusChip value={entry.status} kind={entry.status === 'approved' ? 'good' : 'warn'} />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.observedValue}</p>
                    <p className="mt-2 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground/70">{entry.resolvedAt ? formatDate(entry.resolvedAt) : formatDate(entry.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-7 text-sm text-muted-foreground">No resolved actions yet for this track.</div>
          )}
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel label="Agent telemetry" title="Assessment bounds">
          <div className="p-5"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Confidence</p><p className="mt-1 font-display text-3xl font-semibold tracking-[-.05em]">{Math.round(item.confidence * 100)}%</p></div><div className="grid h-14 w-14 place-items-center rounded-full border-4 border-primary/20 border-t-primary text-xs font-semibold">{Math.round(item.confidence * 100)}</div></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(item.confidence * 100, 100)}%` }} /></div><div className="mt-5 grid grid-cols-2 gap-3"><Bound label="Impact" value={item.impact} icon={<Gauge size={14} />} /><Bound label="Risk" value={item.risk} icon={<AlertTriangle size={14} />} /></div></div>
        </Panel>
        <Panel label="Governance" title="Human-in-the-loop guardrails">
          <div className="space-y-4 p-5 text-xs leading-5 text-muted-foreground"><p className="flex gap-2"><FileSearch size={15} className="mt-0.5 shrink-0 text-primary" />No patient-level data is exposed to the agent. It receives aggregate telemetry and attributed event metadata only.</p><p className="flex gap-2"><ClipboardCheck size={15} className="mt-0.5 shrink-0 text-primary" />A human decision is required. Approval records the action; dismissal leaves the model and privacy state unchanged. Neither is reversible from this screen once recorded.</p><Link href="/academy" className="flex items-center justify-between border-t border-border pt-4 font-semibold text-primary hover:underline" data-testid="link-agent-governance">Read agent governance notes <ArrowRight size={13} /></Link></div>
        </Panel>
      </div>
    </div>
  );
}

function CardRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="px-5 py-4 sm:px-7">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">{icon}{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
function Bound({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="rounded-md border border-border bg-background/50 p-3"><div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="mono-label">{label}</span></div><p className="mt-2 text-xs font-semibold">{value}</p></div>; }
