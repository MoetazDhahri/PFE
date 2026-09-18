import { useContext } from 'react';
import { TrackContext } from '@/components/app-shell';

export function useSelectedTrackId() {
  return useContext(TrackContext).trackId;
}

export function useTrackSelection() {
  return useContext(TrackContext);
}