import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Database, ExternalLink, Eye, LockKeyhole, MapPin, Server, ShieldCheck, Signal, Wifi } from 'lucide-react';
import { Link } from 'wouter';
import { getGetNetworkNodesQueryKey, getGetNetworkOverviewQueryKey, useGetNetworkNodes, useGetNetworkOverview, type ClientNode } from '@workspace/api-client-react';
import { MetricCard } from '@/components/metric-card';
import { PageFrame, Panel, QueryState, StatusChip } from '@/components/app-shell';
import { useSelectedTrackId } from '@/hooks/use-track';
import { formatDate, metric, nodeTone, trackColor } from '@/lib/federation';

export default function Overview() {
  const trackId = useSelectedTrackId();
  const [selectedNode, setSelectedNode] = useState<ClientNode>();
  const overview = useGetNetworkOverview({ track: trackId }, { query: { queryKey: getGetNetworkOverviewQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const nodes = useGetNetworkNodes({ track: trackId }, { query: { queryKey: getGetNetworkNodesQueryKey({ track: trackId }), enabled: Boolean(trackId) } });
  const nodeList = useMemo(() => nodes.data ?? [], [nodes.data]);
  const overviewData = overview.data;
  const color = trackColor(trackId);

  return (
    <PageFrame eyebrow="Live federation / network overview" title={overviewData?.networkName ?? 'Federation overview'} description="A shared command surface for 10 hospitals. Every update is attributed to a node, measured against the active learning track, and checked against privacy policy." actions={<Link href="/training" className="inline-flex items-center gap-2 rounded-md bg-foreground px-3.5 py-2.5 text-xs font-semibold text-background transition-transform hover:-translate-y-0.5" data-testid="link-open-training">Open current round <ArrowRight size={14} /></Link>}>
      <QueryState loading={overview.isLoading || nodes.isLoading} error={overview.isError || nodes.isError} empty={!trackId} onRetry={() => { void overview.refetch(); void nodes.refetch(); }}>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 fade-up-2">
            <MetricCard label="Round" value={overviewData ? `#${overviewData.round}` : '—'} helper={overviewData?.roundStatus ?? 'Awaiting signal'} accent="ink" />
            <MetricCard label="Global AUROC" value={metric(overviewData?.globalAuc)} helper={overviewData?.modelVersion ?? 'Model version pending'} trend="up" />
            <MetricCard label="Accuracy" value={metric(overviewData?.globalAccuracy)} helper={overviewData ? `Track ${overviewData.trackId}` : 'Selected track'} trend="up" accent="ink" />
            <MetricCard label="Privacy budget" value={overviewData ? `${overviewData.privacyBudget.toFixed(1)} ε` : '—'} helper={overviewData?.privacyStatus ?? 'Privacy status pending'} accent="accent" />
            <MetricCard label="Sites online" value={overviewData ? `${overviewData.connectedSites}/${overviewData.totalSites}` : '—'} helper={overviewData?.lastUpdated ? `Updated ${formatDate(overviewData.lastUpdated)}` : 'No recent update'} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.72fr)]">
            <Panel title="Federation topology" label="Live node map" action={<div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{nodeList.length} participating nodes</div>}>
              <div className="relative min-h-[440px] overflow-hidden bg-[radial-gradient(circle_at_50%_50%,hsl(var(--primary)/.11),transparent_42%)] p-4 sm:p-7">
                <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'linear-gradient(hsl(var(--border)/.45) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)/.45) 1px, transparent 1px)', backgroundSize: '38px 38px' }} />
                <div className="absolute left-1/2 top-1/2 z-10 grid h-[112px] w-[112px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/40 bg-card shadow-[0_0_0_11px_hsl(var(--primary)/.07),0_0_0_24px_hsl(var(--primary)/.04)]">
                  <div className="text-center"><Signal size={18} className="mx-auto text-primary" /><p className="mt-2 font-mono text-[10px] font-medium tracking-[.14em]">GLOBAL</p><p className="mt-1 text-[10px] text-muted-foreground">{overviewData?.modelVersion ?? 'Model pending'}</p></div>
                </div>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {nodeList.map((node) => <line key={`line-${node.id}`} x1="50" y1="50" x2={node.x} y2={node.y} stroke="hsl(var(--primary) / .25)" strokeWidth=".25" strokeDasharray="1 1" />)}
                </svg>
                {nodeList.map((node) => {
                  const tone = nodeTone(node.status);
                  const selected = selectedNode?.id === node.id;
                  return <button type="button" key={node.id} onClick={() => setSelectedNode(node)} className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 text-left transition-transform hover:scale-105 ${selected ? 'scale-105' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} data-testid={`button-node-${node.id}`}>
                    <span className={`grid h-10 w-10 place-items-center rounded-full border-2 ${selected ? 'border-primary bg-primary/15' : 'border-card bg-card'} shadow-md`}><span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} /></span>
                    <span className={`mt-1 block max-w-[88px] truncate text-center text-[9px] font-semibold ${selected ? 'text-primary' : 'text-muted-foreground'}`}>{node.shortName}</span>
                  </button>;
                })}
                {!nodeList.length && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">No nodes reported for this track.</div>}
                <div className="absolute bottom-4 left-4 rounded border border-border bg-card/85 px-2.5 py-2 backdrop-blur-sm"><p className="mono-label text-muted-foreground">Signal key</p><div className="mt-2 flex gap-3 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary" />healthy</span><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" />in round</span><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-destructive" />attention</span></div></div>
              </div>
            </Panel>

            <div className="space-y-5">
              <Panel label="Selected track" title={trackId ? trackId.replaceAll('-', ' ') : 'Track context'}>
                <div className="p-5">
                  <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-md font-mono text-[10px]" style={{ background: color.tint, color: color.accent }}>{color.short}</span><div><p className="text-sm font-semibold">{overviewData?.networkName ?? 'Shared imaging federation'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">All node coordinates represent the current participation heartbeat, not patient or geographic precision.</p></div></div>
                  <div className="mt-5 space-y-3 border-t border-border pt-4 text-xs"><div className="flex items-center justify-between"><span className="text-muted-foreground">Privacy posture</span><StatusChip value={overviewData?.privacyStatus} kind="good" /></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Round state</span><StatusChip value={overviewData?.roundStatus} kind="warn" /></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Model lineage</span><span className="font-mono text-[11px]">{overviewData?.modelVersion ?? '—'}</span></div></div>
                </div>
              </Panel>
              <Panel label="Node inspection" title={selectedNode?.name ?? 'Select a hospital node'}>
                {selectedNode ? <div className="p-5"><div className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs"><InfoCell label="Region" value={selectedNode.region} icon={<MapPin size={13} />} /><InfoCell label="Modality" value={selectedNode.modality} icon={<Eye size={13} />} /><InfoCell label="Local AUROC" value={metric(selectedNode.localAuc)} icon={<Signal size={13} />} /><InfoCell label="Data volume" value={selectedNode.dataVolume.toLocaleString()} icon={<Database size={13} />} /><InfoCell label="Last seen" value={formatDate(selectedNode.lastSeen)} icon={<Wifi size={13} />} /><InfoCell label="Privacy" value={selectedNode.privacyStatus} icon={<LockKeyhole size={13} />} /></div><div className="mt-5 flex gap-2"><Link href="/logs" className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" data-testid="link-node-logs"><FileArrow />Review logs</Link><Link href="/privacy" className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background" data-testid="link-node-privacy">Audit trail <ExternalLink size={13} /></Link></div></div> : <div className="flex min-h-[170px] flex-col items-center justify-center px-5 text-center"><Server size={25} className="text-muted-foreground/55" /><p className="mt-3 text-sm font-semibold">Topology is ready to inspect</p><p className="mt-1 max-w-[220px] text-xs leading-5 text-muted-foreground">Choose a node to see local performance, privacy posture, and recent signal.</p></div>}
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