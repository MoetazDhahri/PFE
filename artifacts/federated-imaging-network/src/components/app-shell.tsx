import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, BookOpen, BrainCircuit, ChevronDown, CircleDot, FileClock, FlaskConical, LockKeyhole, Network, ScanLine, ShieldCheck } from 'lucide-react';
import { useClerk, useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { useGetLearningTracks, getGetLearningTracksQueryKey, type LearningTrack } from '@workspace/api-client-react';
import { trackColor } from '@/lib/federation';
import { useRealtimeNetworkUpdates } from '@/hooks/use-realtime';

const navItems = [
  { href: '/overview', label: 'Federation', icon: Network },
  { href: '/training', label: 'Training round', icon: Activity },
  { href: '/inference', label: 'Try the model', icon: ScanLine },
  { href: '/logs', label: 'Activity logs', icon: FileClock },
  { href: '/agent', label: 'Federation agent', icon: BrainCircuit },
  { href: '/privacy', label: 'Privacy & audit', icon: ShieldCheck },
  { href: '/academy', label: 'Knowledge center', icon: BookOpen },
];

export const TrackContext = createContext<{ trackId: string; setTrackId: (value: string) => void; tracks: LearningTrack[] }>({
  trackId: '',
  setTrackId: () => undefined,
  tracks: [],
});

export function AppShell({ children }: { children: ReactNode }) {
  const realtimeStatus = useRealtimeNetworkUpdates();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const clerk = useClerk();
  const { user } = useUser();
  const { data: tracks, isLoading: tracksLoading, isError: tracksError } = useGetLearningTracks({
    query: { queryKey: getGetLearningTracksQueryKey() },
  });
  const safeTracks = useMemo(() => tracks ?? [], [tracks]);
  const [selectedTrackId, setSelectedTrackId] = useState('');

  useEffect(() => {
    if (!selectedTrackId && safeTracks[0]?.id) setSelectedTrackId(safeTracks[0].id);
  }, [safeTracks, selectedTrackId]);

  const activeNav = navItems.find((item) => item.href === location)?.label ?? 'Federation';

  return (
    <TrackContext.Provider value={{ trackId: selectedTrackId, setTrackId: setSelectedTrackId, tracks: safeTracks }}>
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <ShellBrand />
        <div className="px-4 pt-6">
          <p className="mono-label mb-2 text-sidebar-foreground/45">Workspace</p>
          <TrackPicker tracks={safeTracks} selectedTrackId={selectedTrackId} setSelectedTrackId={setSelectedTrackId} compact />
        </div>
        <nav className="mt-7 flex-1 space-y-1 px-3" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link
                href={item.href}
                key={item.href}
                data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}
                className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors ${active ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.7} />
                <span>{item.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-start gap-2.5">
            <CircleDot size={16} className="mt-0.5 text-sidebar-primary" />
            <div>
              <p className="text-xs font-semibold">Consortium control room</p>
              <p className="mt-1 text-[11px] leading-4 text-sidebar-foreground/45">Research network / read-write</p>
            </div>
          </div>
          <p className="mono-label mt-4 text-sidebar-foreground/35">Research use only · v0.8.4</p>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-md sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileOpen((value) => !value)} className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Toggle navigation" data-testid="button-toggle-navigation">
              <Network size={19} />
            </button>
            <div className="min-w-0">
              <p className="mono-label hidden text-muted-foreground sm:block">Federated imaging network / {activeNav}</p>
              <h1 className="truncate font-display text-[18px] font-semibold tracking-[-0.03em]">{activeNav}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 sm:flex" title={realtimeStatus === 'connected' ? 'Real-time updates connected' : realtimeStatus === 'reconnecting' ? 'Real-time connection dropped — retrying' : 'Connecting to real-time updates…'}>
              <span className={`h-1.5 w-1.5 rounded-full ${realtimeStatus === 'connected' ? 'pulse-signal bg-primary' : realtimeStatus === 'reconnecting' ? 'bg-destructive' : 'bg-muted-foreground/50'}`} />
              <span className="mono-label text-muted-foreground">{realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
            </div>
            <div className="relative">
              <button type="button" onClick={() => setProfileOpen((value) => !value)} className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-[11px] font-bold text-background transition-transform hover:scale-105" title="Open profile menu" data-testid="button-open-profile">
                {(user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0] ?? 'R').toUpperCase()}
                {(user?.lastName?.[0] ?? '').toUpperCase()}
              </button>
              {profileOpen && <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border border-border bg-card p-2 shadow-xl">
                <div className="border-b border-border px-3 py-2.5"><p className="truncate text-xs font-semibold">{user?.fullName ?? 'Research operator'}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{user?.primaryEmailAddress?.emailAddress ?? 'Authenticated session'}</p></div>
                <button type="button" onClick={() => { setProfileOpen(false); clerk.openUserProfile(); }} className="mt-1 flex w-full items-center rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-open-account-profile">Account profile</button>
                <button type="button" onClick={() => clerk.signOut({ redirectUrl: `${window.location.origin}${import.meta.env.BASE_URL}` })} className="flex w-full items-center rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-sign-out">Sign out</button>
              </div>}
            </div>
          </div>
        </header>

        {mobileOpen && (
          <div className="fixed inset-x-0 top-[68px] z-30 border-b border-border bg-card p-3 shadow-lg lg:hidden">
            <div className="mb-3">
              <TrackPicker tracks={safeTracks} selectedTrackId={selectedTrackId} setSelectedTrackId={setSelectedTrackId} />
            </div>
            <nav className="grid gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-muted"><Icon size={16} />{item.label}</Link>;
              })}
            </nav>
          </div>
        )}

        <main className="min-h-[calc(100dvh-68px)]">{children}</main>
      </div>

      {tracksLoading && <div className="pointer-events-none fixed bottom-4 right-4 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-lg">Loading tracks…</div>}
      {tracksError && <div className="pointer-events-none fixed bottom-4 right-4 rounded-md border border-[hsl(var(--destructive)/.3)] bg-card px-3 py-2 text-xs text-destructive shadow-lg">Track service unavailable</div>}
    </div>
    </TrackContext.Provider>
  );
}

function ShellBrand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="grid h-9 w-9 place-items-center rounded-lg border border-sidebar-primary/40 bg-sidebar-primary/10 text-sidebar-primary">
        <FlaskConical size={18} />
      </div>
      <div>
        <p className="font-display text-[15px] font-bold tracking-[-0.03em]">NEXUS / FED</p>
        <p className="mono-label mt-0.5 text-sidebar-foreground/40">Imaging consortium</p>
      </div>
    </div>
  );
}

export function TrackPicker({ tracks, selectedTrackId, setSelectedTrackId, compact = false }: { tracks: LearningTrack[]; selectedTrackId: string; setSelectedTrackId: (value: string) => void; compact?: boolean }) {
  const selected = tracks.find((track) => track.id === selectedTrackId);
  const color = trackColor(selectedTrackId);
  return (
    <label className={`relative flex items-center gap-2.5 rounded-md border px-3 ${compact ? 'border-sidebar-border bg-sidebar-accent/55' : 'border-border bg-card'} ${compact ? 'py-2.5' : 'py-2'}`}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[hsl(var(--primary)/.12)] font-mono text-[9px] font-medium" style={{ color: compact ? 'hsl(var(--sidebar-primary))' : color.accent }}>{selected ? color.short : '—'}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] font-semibold ${compact ? 'text-sidebar-foreground' : 'text-foreground'}`}>{selected?.name ?? 'Select a track'}</span>
        <span className={`block truncate text-[10px] ${compact ? 'text-sidebar-foreground/45' : 'text-muted-foreground'}`}>{selected?.task ?? 'Loading federation tracks'}</span>
      </span>
      <ChevronDown size={14} className={compact ? 'text-sidebar-foreground/45' : 'text-muted-foreground'} />
      <select value={selectedTrackId} onChange={(event) => setSelectedTrackId(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Select learning track" data-testid="select-learning-track">
        {!tracks.length && <option value="">Loading…</option>}
        {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
      </select>
    </label>
  );
}

export function PageFrame({ eyebrow, title, description, actions, children }: { eyebrow: string; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="shell-grid min-h-[calc(100dvh-68px)] px-4 py-6 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-[1480px]">
        <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="fade-up">
            <p className="mono-label text-primary">{eyebrow}</p>
            <h2 className="mt-2 font-display text-[clamp(27px,3vw,42px)] font-semibold leading-[1.02] tracking-[-0.055em]">{title}</h2>
            {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="fade-up-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Panel({ children, className = '', title, label, action }: { children: ReactNode; className?: string; title?: string; label?: string; action?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-card-border bg-card shadow-[0_1px_0_hsl(var(--border)/.6)] ${className}`}>
      {(title || label || action) && <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5"><div>{label && <p className="mono-label text-muted-foreground">{label}</p>}{title && <h3 className="mt-1 font-display text-[15px] font-semibold tracking-[-0.02em]">{title}</h3>}</div>{action}</div>}
      {children}
    </section>
  );
}

export function QueryState({ loading, error, empty, children, onRetry }: { loading?: boolean; error?: boolean; empty?: boolean; children: ReactNode; onRetry?: () => void }) {
  if (loading) return <div className="space-y-3"><div className="h-28 animate-pulse rounded-lg bg-muted/60" /><div className="h-48 animate-pulse rounded-lg bg-muted/50" /></div>;
  if (error) return <div className="rounded-lg border border-[hsl(var(--destructive)/.25)] bg-card p-7 text-center"><p className="text-sm font-semibold">The signal could not be read</p><p className="mt-1 text-xs text-muted-foreground">The federation service did not return this view.</p>{onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background" data-testid="button-retry-query">Retry request</button>}</div>;
  if (empty) return <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center"><p className="text-sm font-semibold">No records in this view</p><p className="mt-1 text-xs text-muted-foreground">Change the track or filters to inspect another slice.</p></div>;
  return <>{children}</>;
}

export function StatusChip({ value, kind = 'neutral' }: { value?: string; kind?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const styles = { good: 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]', warn: 'bg-[hsl(var(--accent)/.17)] text-[hsl(var(--accent-foreground))]', bad: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]', neutral: 'bg-muted text-muted-foreground' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[.08em] ${styles[kind]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{value ?? '—'}</span>;
}