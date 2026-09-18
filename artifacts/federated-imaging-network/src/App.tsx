import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AppShell } from '@/components/app-shell';
import Overview from '@/pages/overview';
import Training from '@/pages/training';
import Logs from '@/pages/logs';
import Agent from '@/pages/agent';
import Privacy from '@/pages/privacy';
import Academy from '@/pages/academy';
import Landing from '@/pages/landing';
import { SignInPage, SignUpPage } from '@/pages/auth';
import { clerkAppearance } from '@/lib/clerk-appearance';
import { basePath } from '@/lib/auth';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/" component={HomeRedirect} />
        <Route path="/overview">{() => <ProtectedScreen><Overview /></ProtectedScreen>}</Route>
        <Route path="/training">{() => <ProtectedScreen><Training /></ProtectedScreen>}</Route>
        <Route path="/logs">{() => <ProtectedScreen><Logs /></ProtectedScreen>}</Route>
        <Route path="/agent">{() => <ProtectedScreen><Agent /></ProtectedScreen>}</Route>
        <Route path="/privacy">{() => <ProtectedScreen><Privacy /></ProtectedScreen>}</Route>
        <Route path="/academy">{() => <ProtectedScreen><Academy /></ProtectedScreen>}</Route>
        <Route>{() => <ProtectedScreen><NotFound /></ProtectedScreen>}</Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation('/overview');
  }, [isLoaded, isSignedIn, setLocation]);
  if (!isLoaded || isSignedIn) return <AuthLoading />;
  return <Landing />;
}

function ProtectedScreen({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (isLoaded && !isSignedIn) setLocation('/');
  }, [isLoaded, isSignedIn, setLocation]);
  if (!isLoaded || !isSignedIn) return <AuthLoading />;
  return <AppShell>{children}</AppShell>;
}

function AuthLoading() {
  return <div className="shell-grid grid min-h-[100dvh] place-items-center bg-background"><div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-sm"><span className="pulse-signal h-2 w-2 rounded-full bg-primary" />Checking research session…</div></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to access the research control room',
          },
        },
        signUp: {
          start: {
            title: 'Create your research account',
            subtitle: 'Join the federated imaging workspace',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
            <Router />
            <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        previousUserId.current !== undefined &&
        previousUserId.current !== userId
      ) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener]);

  return null;
}

export default App;
