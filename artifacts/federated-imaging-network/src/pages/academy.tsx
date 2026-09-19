import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Cloud, Compass, Scale, ShieldAlert, Sigma } from 'lucide-react';
import { useSearchParams } from 'wouter';
import { useGetLearningTracks, getGetLearningTracksQueryKey } from '@workspace/api-client-react';
import { PageFrame, Panel, QueryState, TrackPicker } from '@/components/app-shell';
import { useTrackSelection } from '@/hooks/use-track';
import { trackColor } from '@/lib/federation';
import { academyModules, conceptStatusLabel, type AcademyConcept, type ConceptStatus } from '@/lib/academy-content';

function findModuleForConcept(conceptId: string) {
  return academyModules.find((module) => module.concepts.some((concept) => concept.id === conceptId));
}

const STATUS_STYLES: Record<ConceptStatus, string> = {
  implemented: 'bg-primary/10 text-primary',
  simulated: 'bg-accent/15 text-accent-foreground',
  reserved: 'bg-muted text-muted-foreground',
};

export default function Academy() {
  const { data: tracks, isLoading, isError } = useGetLearningTracks({ query: { queryKey: getGetLearningTracksQueryKey() } });
  const { trackId: selectedTrackId, setTrackId: setSelectedTrackId } = useTrackSelection();
  const [searchParams] = useSearchParams();
  const requestedConceptId = searchParams.get('concept');
  const [selectedModuleId, setSelectedModuleId] = useState(() => findModuleForConcept(requestedConceptId ?? '')?.id ?? academyModules[0].id);
  const selected = tracks?.find((track) => track.id === selectedTrackId) ?? tracks?.[0];
  const currentModule = useMemo(() => academyModules.find((item) => item.id === selectedModuleId) ?? academyModules[0], [selectedModuleId]);
  const [selectedConceptId, setSelectedConceptId] = useState(
    () => currentModule.concepts.find((concept) => concept.id === requestedConceptId)?.id ?? currentModule.concepts[0].id,
  );

  // A "Learn more" link (see InfoTip) points here with ?concept=<id>. This
  // reacts to that changing even when the Academy page is already mounted
  // (e.g. clicking a different InfoTip without a full page navigation).
  useEffect(() => {
    if (!requestedConceptId) return;
    const module = findModuleForConcept(requestedConceptId);
    if (!module) return;
    setSelectedModuleId(module.id);
    setSelectedConceptId(requestedConceptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConceptId]);

  const currentConcept = useMemo<AcademyConcept>(
    () => currentModule.concepts.find((item) => item.id === selectedConceptId) ?? currentModule.concepts[0],
    [currentModule, selectedConceptId],
  );
  const accent = trackColor(selected?.id);
  const ModuleIcon = currentModule.icon;
  const conceptCounts = useMemo(
    () =>
      academyModules.reduce(
        (acc, module) => {
          for (const concept of module.concepts) acc[concept.status] += 1;
          return acc;
        },
        { implemented: 0, simulated: 0, reserved: 0 } as Record<ConceptStatus, number>,
      ),
    [],
  );
  const totalConcepts = conceptCounts.implemented + conceptCounts.simulated + conceptCounts.reserved;

  return (
    <PageFrame eyebrow="Knowledge center / research methods" title="Federated ML knowledge center" description="The complete concept map behind this console — federated learning, medical imaging, privacy and security, evaluation, MLOps, the AI agent, and Azure — each entry labeling what is live, what is simulated, and what is reserved for a validated production deployment.">
      <QueryState loading={isLoading} error={isError} empty={!tracks?.length}>
        <div className="space-y-5 fade-up-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <CoverageStat label="Implemented" count={conceptCounts.implemented} total={totalConcepts} tone="good" />
            <CoverageStat label="Simulated" count={conceptCounts.simulated} total={totalConcepts} tone="warn" />
            <CoverageStat label="Reserved for production" count={conceptCounts.reserved} total={totalConcepts} tone="neutral" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[250px_260px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Panel label="Learning track" title="Shared federation">
                <div className="p-4">
                  <TrackPicker tracks={tracks ?? []} selectedTrackId={selected?.id ?? selectedTrackId} setSelectedTrackId={setSelectedTrackId} />
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{selected?.description ?? 'Select a track to anchor the documentation examples.'}</p>
                </div>
              </Panel>
              <Panel label="Sections" title="Documentation map">
                <nav className="p-2">
                  {academyModules.map((item) => {
                    const Icon = item.icon;
                    const active = selectedModuleId === item.id;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => { setSelectedModuleId(item.id); setSelectedConceptId(item.concepts[0].id); }}
                        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-xs transition-colors ${active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                        data-testid={`button-module-${item.id}`}
                      >
                        <Icon size={14} />
                        <span className="flex-1">{item.title}</span>
                        <span className={`mr-1 font-mono text-[9px] ${active ? 'text-background/70' : 'text-muted-foreground/70'}`}>{item.concepts.length}</span>
                        <ChevronRight size={13} className={active ? 'opacity-80' : 'opacity-40'} />
                      </button>
                    );
                  })}
                </nav>
              </Panel>
            </div>

            <Panel label="Concepts" title={currentModule.title}>
              <p className="border-b border-border px-4 py-3 text-[11px] leading-5 text-muted-foreground">{currentModule.intro}</p>
              <nav className="max-h-[620px] overflow-y-auto p-2">
                {currentModule.concepts.map((concept) => {
                  const active = concept.id === currentConcept.id;
                  return (
                    <button
                      type="button"
                      key={concept.id}
                      onClick={() => setSelectedConceptId(concept.id)}
                      className={`mb-1 flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left text-xs transition-colors ${active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'}`}
                      data-testid={`button-concept-${concept.id}`}
                    >
                      <span className="flex-1 leading-4">{concept.title}</span>
                      <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${concept.status === 'implemented' ? 'bg-primary' : concept.status === 'simulated' ? 'bg-accent' : 'bg-muted-foreground/50'}`} />
                    </button>
                  );
                })}
              </nav>
            </Panel>

            <Panel>
              <div className="border-b border-border p-5 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-md" style={{ background: accent.tint, color: accent.accent }}>
                    <ModuleIcon size={18} />
                  </span>
                  <span className="mono-label text-primary">{currentModule.title}</span>
                  <span className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[.1em] ${STATUS_STYLES[currentConcept.status]}`}>{conceptStatusLabel(currentConcept.status)}</span>
                </div>
                <h3 className="mt-5 font-display text-[clamp(23px,2.6vw,34px)] font-semibold tracking-[-.055em]">{currentConcept.title}</h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{currentConcept.summary}</p>
              </div>
              <article className="space-y-5 p-5 sm:p-7">
                {currentConcept.math && <DetailBlock icon={<Sigma size={15} />} label="Mathematical form">
                  <p className="font-mono text-[12px] leading-6 text-foreground">{currentConcept.math}</p>
                </DetailBlock>}
                <DetailBlock icon={<Scale size={15} />} label="Assumptions & tradeoffs">
                  <p className="text-xs leading-6 text-muted-foreground">{currentConcept.tradeoffs}</p>
                </DetailBlock>
                {currentConcept.security && <DetailBlock icon={<ShieldAlert size={15} />} label="Security implications" tone="warn">
                  <p className="text-xs leading-6 text-muted-foreground">{currentConcept.security}</p>
                </DetailBlock>}
                <DetailBlock icon={<Compass size={15} />} label="Where this appears here">
                  <p className="text-xs leading-6 text-muted-foreground">{currentConcept.practicalUse}</p>
                </DetailBlock>
                <div className="rounded-md border border-accent/35 bg-accent/10 p-4 text-xs leading-5 text-foreground">
                  <p className="flex items-start gap-2"><Cloud size={15} className="mt-0.5 shrink-0 text-accent-foreground" /><span><strong>Not a diagnostic device.</strong> This console does not diagnose, triage, recommend treatment, or replace qualified clinical review. Every concept above is documented at the depth it is actually implemented, simulated, or reserved for production — nothing here should be read as a validated clinical or security claim.</span></p>
                </div>
              </article>
            </Panel>
          </div>
        </div>
      </QueryState>
    </PageFrame>
  );
}

function CoverageStat({ label, count, total, tone }: { label: string; count: number; total: number; tone: 'good' | 'warn' | 'neutral' }) {
  const colors = { good: 'border-primary/25 bg-primary/5 text-primary', warn: 'border-accent/30 bg-accent/10 text-accent-foreground', neutral: 'border-border bg-muted/40 text-muted-foreground' };
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`rounded-lg border p-4 ${colors[tone]}`}>
      <div className="flex items-baseline justify-between">
        <span className="mono-label">{label}</span>
        <span className="font-display text-2xl font-semibold tracking-[-.05em]">{count}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/50">
        <div className="h-full rounded-full bg-current" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">{pct}% of {total} documented concepts</p>
    </div>
  );
}

function DetailBlock({ icon, label, children, tone }: { icon: ReactNode; label: string; children: ReactNode; tone?: 'warn' }) {
  return (
    <div>
      <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.1em] ${tone === 'warn' ? 'text-accent-foreground' : 'text-primary'}`}>{icon}{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
