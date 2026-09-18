import { useMemo, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, GitBranch, LockKeyhole, Target, TimerReset } from 'lucide-react';
import { Link } from 'wouter';
import { getGetNetworkEventsQueryKey, getGetNetworkNodesQueryKey, getGetNetworkOverviewQueryKey, useGetNetworkEvents, useGetNetworkNodes, useGetNetworkOverview } from '@workspace/api-client-react';
import { MetricCard } from '@/components/metric-card';
import { PageFrame, Panel, QueryState, StatusChip } from '@/components/app-shell';
import { useSelectedTrackId } from '@/hooks/use-track';
import { formatDate, metric, nodeTone } from '@/lib/federation';

export default function Training() {
  const trackId = useSelectedTrackId();
  const overview = useGetNetworkOverview({ track: trackId }, { query: { queryKey: getGetNetworkOverviewQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const nodes = useGetNetworkNodes({ track: trackId }, { query: { queryKey: getGetNetworkNodesQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const events = useGetNetworkEvents({ track: trackId, limit: 8 }, { query: { queryKey: getGetNetworkEventsQueryKey({ track: trackId, limit: 8 }), enabled: Boolean(trackId) } });
  const nodeList = useMemo(() => nodes.data ?? [], [nodes.data]);
  const overviewData = overview.data;

  return (
    <PageFrame eyebrow={`Round ${overviewData?.round ?? '—'} / training trace`} title="Training round detail" description="A metric-first view of the current global model update, with enough local context to understand divergence before aggregation." actions={<Link href="/agent" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2.5 text-xs font-semibold hover:bg-muted" data-testid="link-review-agent">Review agent assessment <ArrowRight size={14} /></Link>}>
      <QueryState loading={overview.isLoading || nodes.isLoading || events.isLoading} error={overview.isError || nodes.isError || events.isError} empty={!trackId} onRetry={() => { void overview.refetch(); void nodes.refetch(); void events.refetch(); }}>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 fade-up-2">
            <MetricCard label="Round status" value={overviewData?.roundStatus ?? '—'} helper={overviewData?.lastUpdated ? formatDate(overviewData.lastUpdated) : 'Waiting for round'} accent="ink" />
            <MetricCard label="Global AUROC" value={metric(overviewData?.globalAuc)} helper="Across participating sites" trend="up" />
            <MetricCard label="Global accuracy" value={metric(overviewData?.globalAccuracy)} helper="Held-out federation set" trend="up" accent="ink" />
            <MetricCard label="Sites contributing" value={overviewData ? `${overviewData.connectedSites}/${overviewData.totalSites}` : '—'} helper="Update receipts received" accent="accent" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
            <Panel label="Global evaluation" title="Metric trajectory">
              <div className="p-5">
                <div className="flex items-end justify-between gap-3"><div><p className="text-3xl font-semibold tracking-[-.06em]">{metric(overviewData?.globalAuc)}</p><p className="mt-1 text-xs text-muted-foreground">Primary track metric · {overviewData?.modelVersion ?? 'version pending'}</p></div><div className="rounded-md bg-primary/10 px-2.5 py-1.5 font-mono text-[10px] text-primary">+0.014 vs round 17</div></div>
                <div className="relative mt-7 h-[190px] overflow-hidden rounded-md border border-border bg-background/65">
                  <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(hsl(var(--border)/.5) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)/.4) 1px, transparent 1px)', backgroundSize: '20% 25%' }} />
                  <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="Metric trajectory chart">
                    <path d="M0,146 C65,140 80,133 120,138 S178,118 220,126 S270,98 320,108 S360,80 410,88 S470,64 520,70 S564,42 600,48" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" />
                    <path d="M0,146 C65,140 80,133 120,138 S178,118 220,126 S270,98 320,108 S360,80 410,88 S470,64 520,70 S564,42 600,48 L600,180 L0,180 Z" fill="hsl(var(--primary)/.09)" />
                  </svg>
                  <div className="absolute bottom-2 left-3 right-3 flex justify-between font-mono text-[9px] text-muted-foreground"><span>R11</span><span>R13</span><span>R15</span><span>R17</span><span>R18</span></div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-[11px]"><div><p className="text-muted-foreground">Precision</p><p className="mt-1 font-mono">0.816</p></div><div><p className="text-muted-foreground">Recall</p><p className="mt-1 font-mono">0.771</p></div><div><p className="text-muted-foreground">Calibration</p><p className="mt-1 font-mono">0.043 ECE</p></div></div>
              </div>
            </Panel>
            <Panel label="Round control" title="Update integrity">
              <div className="divide-y divide-border">
                <IntegrityRow icon={<GitBranch size={16} />} label="Aggregation" value="FedAvg + clipping" detail="Weighted by approved sample count" />
                <IntegrityRow icon={<LockKeyhole size={16} />} label="Privacy accounting" value={`${overviewData?.privacyBudget.toFixed(1) ?? '—'} ε`} detail={overviewData?.privacyStatus ?? 'Budget status pending'} />
                <IntegrityRow icon={<Target size={16} />} label="Evaluation gate" value="Passed" detail="No threshold regressions detected" good />
                <IntegrityRow icon={<TimerReset size={16} />} label="Next checkpoint" value="14:32 UTC" detail="Awaiting final site receipt" />
              </div>
              <div className="border-t border-border p-4"><Link href="/privacy" className="flex items-center justify-between text-xs font-semibold text-primary hover:underline" data-testid="link-training-privacy">Open privacy accounting <ArrowRight size={13} /></Link></div>
            </Panel>
          </div>
          <Panel label="Local update receipts" title="Participating nodes" action={<span className="mono-label text-muted-foreground">sorted by site</span>}>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-border bg-muted/35 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Node</th><th className="px-3 py-3 font-medium">State</th><th className="px-3 py-3 font-medium">Local AUROC</th><th className="px-3 py-3 font-medium">Samples</th><th className="px-3 py-3 font-medium">Privacy</th><th className="px-5 py-3 text-right font-medium">Last seen</th></tr></thead><tbody className="divide-y divide-border">{nodeList.map((node) => { const tone = nodeTone(node.status); return <tr key={node.id} className="transition-colors hover:bg-muted/35" data-testid={`row-training-node-${node.id}`}><td className="px-5 py-3.5"><div className="flex items-center gap-2.5"><span className={`h-2 w-2 rounded-full ${tone.dot}`} /><div><p className="font-semibold">{node.name}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{node.region} · {node.modality}</p></div></div></td><td className={`px-3 py-3.5 font-mono text-[10px] ${tone.label}`}>{node.status}</td><td className="px-3 py-3.5 font-mono">{metric(node.localAuc)}</td><td className="px-3 py-3.5 font-mono">{node.dataVolume.toLocaleString()}</td><td className="px-3 py-3.5"><StatusChip value={node.privacyStatus} kind="good" /></td><td className="px-5 py-3.5 text-right font-mono text-[10px] text-muted-foreground">{formatDate(node.lastSeen)}</td></tr>; })}</tbody></table></div>
          </Panel>
          <div className="flex items-center gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground"><CheckCircle2 size={14} className="text-primary" /> Metric values are evaluation telemetry and should not be interpreted as clinical performance claims.</div>
        </div>
      </QueryState>
    </PageFrame>
  );
}

function IntegrityRow({ icon, label, value, detail, good }: { icon: ReactNode; label: string; value: string; detail: string; good?: boolean }) {
  return <div className="flex items-start gap-3 px-5 py-4"><span className="mt-0.5 text-primary">{icon}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{label}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p></div><span className={`font-mono text-[10px] ${good ? 'text-primary' : ''}`}>{value}</span></div>;
}