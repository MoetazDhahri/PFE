import type { ActivityEvent, ClientNode, LearningTrack } from '@workspace/api-client-react';

export const trackMeta: Record<string, { short: string; accent: string; tint: string }> = {
  'cxr-classification': { short: 'CXR', accent: 'hsl(166 48% 42%)', tint: 'hsl(166 48% 42% / .11)' },
  'brain-mri-segmentation': { short: 'MRI', accent: 'hsl(207 54% 48%)', tint: 'hsl(207 54% 48% / .11)' },
  'ct-lesion-detection': { short: 'CT', accent: 'hsl(27 73% 58%)', tint: 'hsl(27 73% 58% / .13)' },
};

export function trackColor(trackId?: string) {
  return trackMeta[trackId ?? ''] ?? { short: 'FL', accent: 'hsl(166 48% 42%)', tint: 'hsl(166 48% 42% / .11)' };
}

export function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function metric(value?: number, digits = 3) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

export function eventTone(event?: ActivityEvent) {
  const severity = event?.severity?.toLowerCase();
  if (severity === 'critical' || severity === 'error') return 'text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.1)]';
  if (severity === 'warning' || severity === 'warn') return 'text-[hsl(var(--accent-foreground))] bg-[hsl(var(--accent)/.16)]';
  return 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/.12)]';
}

export function nodeTone(status?: string) {
  const value = status?.toLowerCase();
  if (value?.includes('error') || value?.includes('offline')) return { dot: 'bg-[hsl(var(--destructive))]', label: 'text-[hsl(var(--destructive))]' };
  if (value?.includes('round') || value?.includes('train')) return { dot: 'bg-[hsl(var(--accent))]', label: 'text-[hsl(var(--accent-foreground))]' };
  return { dot: 'bg-[hsl(var(--primary))]', label: 'text-[hsl(var(--primary))]' };
}

export function trackName(trackId: string | undefined, tracks?: LearningTrack[]) {
  return tracks?.find((track) => track.id === trackId)?.name ?? trackId ?? 'Learning track';
}

export function sortNodes(nodes?: ClientNode[]) {
  return [...(nodes ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}