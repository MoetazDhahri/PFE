import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Database, ExternalLink, Eye, LockKeyhole, MapPin, Server, ShieldCheck, Signal, X, Wifi } from 'lucide-react';
import { Link, useSearchParams } from 'wouter';
import { getGetNetworkNodesQueryKey, getGetNetworkOverviewQueryKey, useGetNetworkNodes, useGetNetworkOverview, type ClientNode } from '@workspace/api-client-react';
import { MetricCard } from '@/components/metric-card';
import { InfoTip } from '@/components/info-tip';
import { PageFrame, Panel, QueryState, StatusChip } from '@/components/app-shell';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSelectedTrackId } from '@/hooks/use-track';
import { formatDate, metric, nodeStatusGroup, nodeStrokeColor, nodeTone, trackColor, type NodeStatusGroup } from '@/lib/federation';

export default function Overview() {
  const trackId = useSelectedTrackId();
  const [searchParams] = useSearchParams();
  const requestedNodeId = searchParams.get('node');
  const [selectedNode, setSelectedNode] = useState<ClientNode>();
  const [statusFilter, setStatusFilter] = useState<NodeStatusGroup>();
  const overview = useGetNetworkOverview({ track: trackId }, { query: { queryKey: getGetNetworkOverviewQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const nodes = useGetNetworkNodes({ track: trackId }, { query: { queryKey: getGetNetworkNodesQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const nodeList = useMemo(() => nodes.data ?? [], [nodes.data]);
  const overviewData = overview.data;
  const color = trackColor(trackId);

  // A node link elsewhere (see training.tsx's node table) points here with
  // ?node=<id> — jump straight to that node's inspector once the node list
  // has loaded, instead of leaving the visitor to find it themselves.
  useEffect(() => {
    if (!requestedNodeId) return;
    const match = nodeList.find((node) => node.id === requestedNodeId);
    if (match) setSelectedNode(match);
  }, [requestedNodeId, nodeList]);
  const statusCounts = useMemo(() => {
    const counts: Record<NodeStatusGroup, number> = { healthy: 0, active: 0, attention: 0 };
    for (const node of nodeList) counts[nodeStatusGroup(node.status)] += 1;
    return counts;
  }, [nodeList]);

  return (
    <PageFrame eyebrow="Live federation / network overview" title={overviewData?.networkName ?? 'Federation overview'} description="A shared command surface for 10 hospitals. Every update is attributed to a node, measured against the active learning track, and checked against privacy policy." actions={<Link href="/training" className="inline-flex items-center gap-2 rounded-md bg-foreground px-3.5 py-2.5 text-xs font-semibold text-background transition-transform hover:-translate-y-0.5" data-testid="link-open-training">Open current round <ArrowRight size={14} /></Link>}>
      <QueryState loading={overview.isLoading || nodes.isLoading} error={overview.isError || nodes.isError} empty={!trackId} onRetry={() => { void overview.refetch(); void nodes.refetch(); }}>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 fade-up-2">
            <MetricCard label="Round" value={overviewData ? `#${overviewData.round}` : '—'} helper={overviewData?.roundStatus ?? 'Awaiting signal'} accent="ink" href="/training" />
            <MetricCard
              label="Global AUROC"
              value={metric(overviewData?.globalAuc)}
              helper={overviewData?.modelVersion ?? 'Model version pending'}
              trend="up"
              infoTip={{ definition: 'Area under the ROC curve — how well the model separates the two classes across every possible decision threshold. 1.0 is perfect, 0.5 is a coin flip.', conceptId: 'imaging-metrics' }}
            />
            <MetricCard label="Accuracy" value={metric(overviewData?.globalAccuracy)} helper={overviewData ? `Track ${overviewData.trackId}` : 'Selected track'} trend="up" accent="ink" />
            <MetricCard
              label="Privacy budget"
              value={overviewData ? `${overviewData.privacyBudget.toFixed(1)} ε` : '—'}
              helper={overviewData?.privacyStatus ?? 'Privacy status pending'}
              accent="accent"
              href="/privacy"
              infoTip={{ definition: 'Epsilon (ε): the real, cumulative differential-privacy cost of training so far — lower is more private. It only ever grows as more rounds run; it is not a remaining balance.', conceptId: 'differential-privacy' }}
            />
            <MetricCard label="Sites online" value={overviewData ? `${overviewData.connectedSites}/${overviewData.totalSites}` : '—'} helper={overviewData?.lastUpdated ? `Updated ${formatDate(overviewData.lastUpdated)}` : 'No recent update'} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.72fr)]">
            <Panel
              title="Federation topology"
              label="Live node map"
              action={
                <div className="flex items-center gap-3">
                  <LegendToggle tone="healthy" count={statusCounts.healthy} active={statusFilter} onToggle={setStatusFilter} dotClass="bg-primary" label="healthy" />
                  <LegendToggle tone="active" count={statusCounts.active} active={statusFilter} onToggle={setStatusFilter} dotClass="bg-accent" label="in round" />
                  <LegendToggle tone="attention" count={statusCounts.attention} active={statusFilter} onToggle={setStatusFilter} dotClass="bg-destructive" label="attention" />
                </div>
              }
            >
              <div className="relative min-h-[440px] overflow-hidden bg-[radial-gradient(circle_at_50%_50%,hsl(var(--primary)/.11),transparent_42%)] p-4 sm:p-7">
                <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'linear-gradient(hsl(var(--border)/.45) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)/.45) 1px, transparent 1px)', backgroundSize: '38px 38px' }} />
                <Link
                  href="/training"
                  className="absolute left-1/2 top-1/2 z-10 grid h-[112px] w-[112px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/40 bg-card shadow-[0_0_0_11px_hsl(var(--primary)/.07),0_0_0_24px_hsl(var(--primary)/.04)] transition-transform hover:scale-[1.04]"
                  title="Open current training round"
                  data-testid="link-topology-global"
                >
                  <div className="text-center"><Signal size={18} className="mx-auto text-primary" /><p className="mt-2 font-mono text-[10px] font-medium tracking-[.14em]">GLOBAL</p><p className="mt-1 text-[10px] text-muted-foreground">{overviewData?.modelVersion ?? 'Model pending'}</p></div>
                </Link>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {nodeList.map((node) => {
                    const dimmed = statusFilter && nodeStatusGroup(node.status) !== statusFilter;
                    return (
                      <line
                        key={`line-${node.id}`}
                        x1="50"
                        y1="50"
                        x2={node.x}
                        y2={node.y}
                        stroke={nodeStrokeColor(node.status)}
                        strokeOpacity={dimmed ? 0.08 : 0.35}
                        strokeWidth=".3"
                        strokeDasharray="1.4 1.4"
                        className="topology-flow-line"
                      />
                    );
                  })}
                </svg>
                {nodeList.map((node) => {
                  const tone = nodeTone(node.status);
                  const selected = selectedNode?.id === node.id;
                  const dimmed = statusFilter && nodeStatusGroup(node.status) !== statusFilter;
                  return (
                    <Tooltip key={node.id} delayDuration={200}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setSelectedNode(selected ? undefined : node)}
                          className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 text-left transition-all hover:scale-105 ${selected ? 'scale-105' : ''} ${dimmed ? 'opacity-25' : 'opacity-100'}`}
                          style={{ left: `${node.x}%`, top: `${node.y}%` }}
                          data-testid={`button-node-${node.id}`}
                        >
                          <span className={`grid h-10 w-10 place-items-center rounded-full border-2 ${selected ? 'border-primary bg-primary/15' : 'border-card bg-card'} shadow-md`}><span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} /></span>
                          <span className={`mt-1 block max-w-[88px] truncate text-center text-[9px] font-semibold ${selected ? 'text-primary' : 'text-muted-foreground'}`}>{node.shortName}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="bg-foreground text-background">
                        <p className="font-semibold">{node.name}</p>
                        <p className="mt-0.5 text-[10px] opacity-80">{node.status} · AUROC {metric(node.localAuc)} · {node.dataVolume.toLocaleString()} samples</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {!nodeList.length && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">No nodes reported for this track.</div>}
                {statusFilter && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter(undefined)}
                    className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground backdrop-blur-sm hover:text-foreground"
                    data-testid="button-clear-topology-filter"
                  >
                    <X size={11} /> Clear filter
                  </button>
                )}
              </div>
            </Panel>

            <div className="space-y-5">
              <Panel label="Selected track" title={trackId ? trackId.replaceAll('-', ' ') : 'Track context'}>
                <div className="p-5">
                  <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-md font-mono text-[10px]" style={{ background: color.tint, color: color.accent }}>{color.short}</span><div><p className="text-sm font-semibold">{overviewData?.networkName ?? 'Shared imaging federation'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">All node coordinates represent the current participation heartbeat, not patient or geographic precision.</p></div></div>
                  <div className="mt-5 space-y-3 border-t border-border pt-4 text-xs"><div className="flex items-center justify-between"><span className="text-muted-foreground">Privacy posture</span><StatusChip value={overviewData?.privacyStatus} kind="good" /></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Round state</span><StatusChip value={overviewData?.roundStatus} kind="warn" /></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Model lineage</span><span className="font-mono text-[11px]">{overviewData?.modelVersion ?? '—'}</span></div></div>
                </div>
              </Panel>
              <Panel
                label="Node inspection"
                title={selectedNode?.name ?? 'Select a hospital node'}
                action={selectedNode && <button type="button" onClick={() => setSelectedNode(undefined)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Clear selection" data-testid="button-clear-node-selection"><X size={14} /></button>}
              >
                {selectedNode ? <div className="p-5"><div className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs"><InfoCell label="Region" value={selectedNode.region} icon={<MapPin size={13} />} /><InfoCell label="Modality" value={selectedNode.modality} icon={<Eye size={13} />} /><InfoCell label="Local AUROC" value={metric(selectedNode.localAuc)} icon={<Signal size={13} />} /><InfoCell label="Data volume" value={selectedNode.dataVolume.toLocaleString()} icon={<Database size={13} />} /><InfoCell label="Last seen" value={formatDate(selectedNode.lastSeen)} icon={<Wifi size={13} />} /><InfoCell label="Privacy" value={selectedNode.privacyStatus} icon={<LockKeyhole size={13} />} /></div><div className="mt-5 flex gap-2"><Link href="/logs" className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" data-testid="link-node-logs"><FileArrow />Review logs</Link><Link href="/privacy" className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background" data-testid="link-node-privacy">Audit trail <ExternalLink size={13} /></Link></div></div> : <div className="flex min-h-[170px] flex-col items-center justify-center px-5 text-center"><Server size={25} className="text-muted-foreground/55" /><p className="mt-3 text-sm font-semibold">Hover or click a node</p><p className="mt-1 max-w-[220px] text-xs leading-5 text-muted-foreground">Hover any node in the map for a quick readout, or click one to see full local performance, privacy posture, and recent signal here.</p></div>}
              </Panel>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground"><ShieldCheck size={14} className="text-primary" /> All metrics are research telemetry. This interface is not a diagnostic device or clinical decision support system.</div>
        </div>
      </QueryState>
    </PageFrame>
  );
}

function InfoCell({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div><div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="mono-label">{label}</span></div><p className="mt-1.5 truncate font-mono text-[11px] text-foreground">{value}</p></div>;
}
function FileArrow() { return <ArrowRight size={13} />; }

function LegendToggle({ tone, count, active, onToggle, dotClass, label }: { tone: NodeStatusGroup; count: number; active?: NodeStatusGroup; onToggle: (value: NodeStatusGroup | undefined) => void; dotClass: string; label: string }) {
  const isActive = active === tone;
  return (
    <button
      type="button"
      onClick={() => onToggle(isActive ? undefined : tone)}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors ${isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      data-testid={`button-legend-${tone}`}
      title={`Show only ${label} nodes`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {count} {label}
    </button>
  );
}