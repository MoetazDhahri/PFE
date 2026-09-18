import { SignIn, SignUp } from '@clerk/react';
import { type ReactNode } from 'react';
import { Link } from 'wouter';
import { basePath } from '@/lib/auth';
import { clerkAppearance } from '@/lib/clerk-appearance';

export function SignInPage() {
  return <AuthFrame eyebrow="Return to the control room" title="Sign in to NEXUS / FED"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={`${basePath}/overview`} appearance={clerkAppearance} /></AuthFrame>;
}

export function SignUpPage() {
  return <AuthFrame eyebrow="Join the consortium console" title="Create a research account"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/overview`} appearance={clerkAppearance} /></AuthFrame>;
}

function AuthFrame({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="shell-grid flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-6"><div className="grid w-full max-w-[980px] gap-8 lg:grid-cols-[.8fr_1fr] lg:items-center"><div className="hidden lg:block"><Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="link-auth-home"><span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background"><span className="font-mono text-[10px]">NF</span></span>NEXUS / FED</Link><p className="mono-label mt-16 text-primary">{eyebrow}</p><h1 className="mt-4 max-w-sm font-display text-5xl font-semibold leading-[.98] tracking-[-.07em]">{title}</h1><p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">A calm, auditable workspace for a live medical-imaging research federation.</p><div className="mt-10 flex items-center gap-2 text-[11px] text-muted-foreground"><ShieldIcon /> Research only · not a diagnostic device</div></div><div className="flex justify-center">{children}</div></div></div>;
}
function ShieldIcon() { return <span className="grid h-5 w-5 place-items-center rounded bg-primary/10 text-primary">S</span>; }