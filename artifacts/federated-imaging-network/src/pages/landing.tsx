import { ArrowRight, BrainCircuit, Check, ChevronRight, Database, FlaskConical, LockKeyhole, Network, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';

const tracks = [
  { code: 'CXR', title: 'Chest X-ray classification', detail: 'Find signal in portable radiography without moving the image.' },
  { code: 'MRI', title: 'Brain MRI segmentation', detail: 'Map structures with site-local annotation and transparent metrics.' },
  { code: 'CT', title: 'CT lesion detection', detail: 'Coordinate lesion candidates across a distributed cohort.' },
];

export default function Landing() {
  const { isSignedIn } = useUser();
  return (
    <div className="min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <header className="relative z-20 flex items-center justify-between border-b border-border/70 px-5 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-3" data-testid="link-public-logo">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background"><FlaskConical size={18} /></span>
          <span><span className="block font-display text-[15px] font-bold tracking-[-.035em]">NEXUS / FED</span><span className="mono-label block text-muted-foreground">Imaging consortium</span></span>
        </Link>
        <nav className="flex items-center gap-2">
          <a href="#promise" className="hidden px-3 py-2 text-xs text-muted-foreground hover:text-foreground sm:inline-flex">Privacy promise</a>
          <a href="#tracks" className="hidden px-3 py-2 text-xs text-muted-foreground hover:text-foreground sm:inline-flex">Learning tracks</a>
          {isSignedIn ? <Link href="/overview" className="inline-flex items-center gap-2 rounded-md bg-foreground px-3.5 py-2 text-xs font-semibold text-background" data-testid="link-enter-console">Enter console <ArrowRight size={13} /></Link> : <Link href="/sign-in" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2 text-xs font-semibold hover:bg-muted" data-testid="link-public-sign-in">Sign in <ArrowRight size={13} /></Link>}
        </nav>
      </header>

      <main>
        <section className="relative px-5 pb-16 pt-16 sm:px-10 sm:pb-24 sm:pt-24">
          <div className="absolute inset-0 -z-0 opacity-65" style={{ backgroundImage: 'radial-gradient(circle at 74% 26%, hsl(var(--primary)/.15), transparent 24%), linear-gradient(hsl(var(--border)/.4) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)/.4) 1px, transparent 1px)', backgroundSize: 'auto, 32px 32px, 32px 32px' }} />
          <div className="relative z-10 mx-auto grid max-w-[1220px] items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
            <div className="fade-up">
              <p className="mono-label flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary pulse-signal" /> Research network / live control plane</p>
              <h1 className="mt-6 max-w-3xl font-display text-[clamp(43px,7vw,86px)] font-semibold leading-[.94] tracking-[-.075em]">The signal stays local. <span className="text-primary">The learning travels.</span></h1>
              <p className="mt-7 max-w-xl text-[15px] leading-7 text-muted-foreground sm:text-base">NEXUS / FED is the operations center for a 10-hospital medical-imaging federation. See every round, privacy check, metric, and agent recommendation with the context to trust it.</p>
              <div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-up" className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-3 text-xs font-semibold text-background transition-transform hover:-translate-y-0.5" data-testid="link-public-sign-up">Join the research console <ArrowRight size={14} /></Link><a href="#how-it-works" className="inline-flex items-center gap-2 rounded-md border border-border bg-card/75 px-4 py-3 text-xs font-semibold hover:bg-card" data-testid="link-public-how-it-works">How it works <ChevronRight size={14} /></a></div>
              <p className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground"><ShieldCheck size={14} className="text-primary" /> Research-only infrastructure. Never a diagnostic device.</p>
            </div>
            <div className="fade-up-2 relative min-h-[360px] rounded-xl border border-border bg-card/75 p-5 shadow-[0_20px_70px_hsl(var(--foreground)/.08)] backdrop-blur-sm sm:min-h-[430px] sm:p-8">
              <div className="flex items-center justify-between"><div><p className="mono-label text-primary">Federation topology</p><p className="mt-1 text-xs text-muted-foreground">10 client nodes · shared model</p></div><span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.09em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Live</span></div>
              <div className="relative mt-7 h-[275px] sm:h-[330px]">
                <div className="absolute left-1/2 top-1/2 z-10 grid h-[94px] w-[94px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/45 bg-background shadow-[0_0_0_14px_hsl(var(--primary)/.06),0_0_0_30px_hsl(var(--primary)/.035)]"><div className="text-center"><Network size={18} className="mx-auto text-primary" /><p className="mt-1.5 font-mono text-[9px] tracking-[.16em]">GLOBAL</p><p className="mt-1 text-[9px] text-muted-foreground">v0.8.4</p></div></div>
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Federation network illustration">{[[13,22],[48,9],[83,23],[92,58],[73,88],[48,95],[17,86],[6,57],[28,45],[77,47]].map(([x,y], i) => <g key={i}><line x1="50" y1="50" x2={x} y2={y} stroke="hsl(var(--primary)/.3)" strokeWidth=".3" strokeDasharray="1.1 1.2" /><circle cx={x} cy={y} r="1.6" fill="hsl(var(--primary))" /></g>)}</svg>
                {['NW', 'N1', 'NE', 'E1', 'SE', 'S1', 'SW', 'W1', 'C1', 'C2'].map((label, i) => { const positions = [[13,22],[48,9],[83,23],[92,58],[73,88],[48,95],[17,86],[6,57],[28,45],[77,47]]; return <span key={label} className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/25 bg-card font-mono text-[8px] text-primary shadow-sm" style={{ left: `${positions[i][0]}%`, top: `${positions[i][1]}%` }}>{label}</span>; })}
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-4 text-center"><div><p className="font-display text-lg font-semibold">10</p><p className="mono-label text-muted-foreground">sites</p></div><div><p className="font-display text-lg font-semibold text-primary">3</p><p className="mono-label text-muted-foreground">tracks</p></div><div><p className="font-display text-lg font-semibold">0</p><p className="mono-label text-muted-foreground">raw images moved</p></div></div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-border bg-card/50 px-5 py-12 sm:px-10 sm:py-16"><div className="mx-auto grid max-w-[1220px] gap-8 md:grid-cols-3">{[{n:'01', title:'Observe the network', detail:'Follow round state, node heartbeats, local metrics, and update receipts in one calm surface.', icon:<Network size={18} />},{n:'02', title:'Explain the decision', detail:'Inspect evidence, privacy posture, event logs, and the bounded agent assessment behind a recommendation.', icon:<BrainCircuit size={18} />},{n:'03', title:'Record the human call', detail:'Approve or dismiss agent actions explicitly. The resolution becomes part of the auditable trail.', icon:<Check size={18} />}].map((item) => <div key={item.n} className="flex gap-4"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">{item.icon}</div><div><p className="mono-label text-primary">{item.n}</p><h2 className="mt-2 font-display text-lg font-semibold tracking-[-.03em]">{item.title}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p></div></div>)}</div></section>

        <section id="tracks" className="px-5 py-16 sm:px-10 sm:py-24"><div className="mx-auto max-w-[1220px]"><div className="max-w-xl"><p className="mono-label text-primary">One federation / three questions</p><h2 className="mt-3 font-display text-[clamp(30px,4vw,52px)] font-semibold leading-none tracking-[-.06em]">Built for the shape of the image.</h2><p className="mt-4 text-sm leading-6 text-muted-foreground">Switch between shared tracks without losing the operational context. Each task keeps its own metric lens, local data boundary, and documented assumptions.</p></div><div className="mt-10 grid gap-4 lg:grid-cols-3">{tracks.map((track, i) => <div key={track.code} className="group rounded-lg border border-border bg-card p-5 transition-transform hover:-translate-y-1 sm:p-6"><div className={`flex items-center justify-between ${i === 1 ? 'text-[hsl(207_54%_48%)]' : i === 2 ? 'text-accent-foreground' : 'text-primary'}`}><span className="font-mono text-xs font-medium tracking-[.18em]">{track.code}</span><ChevronRight size={15} className="transition-transform group-hover:translate-x-1" /></div><h3 className="mt-14 font-display text-xl font-semibold tracking-[-.04em]">{track.title}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{track.detail}</p><div className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-[10px] uppercase tracking-[.1em] text-muted-foreground"><Database size={13} /> site-local training</div></div>)}</div></div></section>

        <section id="promise" className="bg-foreground px-5 py-16 text-background sm:px-10 sm:py-24"><div className="mx-auto grid max-w-[1220px] gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-end"><div><p className="mono-label text-sidebar-primary">The privacy promise</p><h2 className="mt-4 font-display text-[clamp(31px,4vw,56px)] font-semibold leading-[.98] tracking-[-.065em]">Learn together.<br /><span className="text-sidebar-primary">Keep the image home.</span></h2></div><div className="grid gap-6 sm:grid-cols-2"><Promise icon={<LockKeyhole size={18} />} title="Raw imaging stays local" detail="The control plane sees attributed telemetry and aggregate updates, not patient imaging payloads." /><Promise icon={<ShieldCheck size={18} />} title="Privacy is observable" detail="Budget, clipping, secure aggregation posture, and site attestations are first-class operational states." /><Promise icon={<Sparkles size={18} />} title="Recommendations are bounded" detail="The Federation Agent shows evidence, confidence, impact, and risk before a human records a decision." /><Promise icon={<FlaskConical size={18} />} title="Research is the boundary" detail="Metrics and actions support consortium research operations. They do not diagnose, triage, or replace clinical judgment." /></div></div></section>
      </main>
      <footer className="flex flex-col justify-between gap-3 border-t border-border px-5 py-6 text-[11px] text-muted-foreground sm:flex-row sm:px-10"><p>© 2025 NEXUS / FED · Medical imaging research consortium</p><p className="flex items-center gap-2"><ShieldCheck size={13} className="text-primary" /> Not a diagnostic device</p></footer>
    </div>
  );
}

function Promise({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="border-t border-background/15 pt-4"><div className="flex items-center gap-2 text-sidebar-primary">{icon}<h3 className="text-sm font-semibold text-background">{title}</h3></div><p className="mt-2 text-xs leading-5 text-background/60">{detail}</p></div>;
}