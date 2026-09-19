import { useMemo, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Fingerprint, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { getGetNetworkEventsQueryKey, getGetNetworkNodesQueryKey, getGetNetworkOverviewQueryKey, useGetNetworkEvents, useGetNetworkNodes, useGetNetworkOverview } from '@workspace/api-client-react';
import { PageFrame, Panel, QueryState, StatusChip } from '@/components/app-shell';
import { useSelectedTrackId } from '@/hooks/use-track';
import { formatDate, eventTone } from '@/lib/federation';

export default function Privacy() {
  const trackId = useSelectedTrackId();
  const overview = useGetNetworkOverview({ track: trackId }, { query: { queryKey: getGetNetworkOverviewQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const nodes = useGetNetworkNodes({ track: trackId }, { query: { queryKey: getGetNetworkNodesQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const events = useGetNetworkEvents({ track: trackId, limit: 20 }, { query: { queryKey: getGetNetworkEventsQueryKey({ track: trackId, limit: 20 }), enabled: Boolean(trackId) } });
  const privacyEvents = useMemo(() => (events.data ?? []).filter((event) => event.type.toLowerCase().includes('privacy') || event.title.toLowerCase().includes('privacy')), [events.data]);
  const privacyGood = nodes.data?.filter((node) => node.privacyStatus.toLowerCase().includes('ok') || node.privacyStatus.toLowerCase().includes('pass') || node.privacyStatus.toLowerCase().includes('healthy')).length ?? 0;

  return (
    <PageFrame eyebrow="Control plane / privacy & accountability" title="Privacy and audit" description="Privacy is a live operational state, not a footnote. Inspect budget, node attestations, and the immutable-looking event trail that supports every research decision." actions={<Link href="/academy" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2.5 text-xs font-semibold hover:bg-muted" data-testid="link-privacy-academy">Privacy foundations <ArrowRight size={14} /></Link>}>
      <QueryState loading={overview.isLoading || nodes.isLoading || events.isLoading} error={overview.isError || nodes.isError || events.isError} empty={!trackId} onRetry={() => { void overview.refetch(); void nodes.refetch(); void events.refetch(); }}>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 fade-up-2"><PrivacyStat icon={<LockKeyhole size={17} />} label="Privacy budget" value={overview.data ? `${overview.data.privacyBudget.toFixed(1)} ε` : '—'} detail={overview.data?.privacyStatus ?? '—'} /><PrivacyStat icon={<ShieldCheck size={17} />} label="Node attestations" value={`${privacyGood}/${nodes.data?.length ?? 0}`} detail="Current track" /><PrivacyStat icon={<Fingerprint size={17} />} label="Audit events" value={String(privacyEvents.length)} detail="In recent window" /><PrivacyStat icon={<KeyRound size={17} />} label="Data boundary" value="Local only" detail="No raw imaging leaves site" /></div>
          <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
            <Panel label="Privacy accountant" title="Budget posture">
              <div className="p-5 sm:p-6"><div className="flex items-end justify-between"><div><p className="font-display text-4xl font-semibold tracking-[-.07em]">{overview.data?.privacyBudget.toFixed(1) ?? '—'}<span className="ml-1 text-lg text-muted-foreground">ε</span></p><p className="mt-2 text-xs text-muted-foreground">Cumulative epsilon spent training the active track so far — grows every round by design (see the Knowledge Center's differential-privacy module for why), not a remaining balance</p></div><StatusChip value={overview.data?.privacyStatus} kind="good" /></div><div className="mt-7 grid gap-3 text-xs"><PolicyRow label="Gradient clipping" value="Enabled (DP-SGD)" /><PolicyRow label="Noise mechanism" value="Gaussian (DP-SGD, Opacus)" /><PolicyRow label="Secure aggregation" value="Not implemented" /><PolicyRow label="Raw DICOM egress" value="Blocked" /></div></div>
            </Panel>
            <Panel label="Site attestations" title="Local privacy posture">
              <div className="divide-y divide-border">{(nodes.data ?? []).map((node) => <div key={node.id} className="flex items-center gap-3 px-5 py-3.5" data-testid={`row-privacy-node-${node.id}`}><div className="grid h-8 w-8 place-items-center rounded bg-primary/10 font-mono text-[9px] text-primary">{node.shortName.slice(0, 3)}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{node.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{node.region} · last seen {formatDate(node.lastSeen)}</p></div><StatusChip value={node.privacyStatus} kind="good" /></div>)}</div>
            </Panel>
          </div>
          <Panel label="Audit ledger" title="Privacy-related events" action={<Link href="/logs" className="text-[11px] font-semibold text-primary hover:underline" data-testid="link-open-full-logs">Full event stream</Link>}>
            <div className="divide-y divide-border">{privacyEvents.length ? privacyEvents.map((event) => <div key={event.id} className="flex gap-3 px-5 py-4"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{event.title}</p><span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${eventTone(event)}`}>{event.severity}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{event.detail}</p><p className="mt-2 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground/70">{formatDate(event.timestamp)} · actor {event.actor}</p></div></div>) : <div className="p-7 text-sm text-muted-foreground">No privacy events in the current window.</div>}</div>
          </Panel>
          <div className="flex items-center gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground"><ShieldCheck size={14} className="text-primary" /> Privacy indicators describe research-system controls. They are not a certification or a guarantee of clinical compliance.</div>
        </div>
      </QueryState>
    </PageFrame>
  );
}
function PrivacyStat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) { return <div className="rounded-lg border border-card-border bg-card px-4 py-4"><div className="flex items-center gap-2 text-primary">{icon}<span className="mono-label text-muted-foreground">{label}</span></div><p className="mt-3 font-display text-2xl font-semibold tracking-[-.05em]">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>; }
function PolicyRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-border pb-2.5 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-mono text-[10px] text-primary">{value}</span></div>; }