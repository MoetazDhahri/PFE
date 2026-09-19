import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';

// Real-time push: the API server broadcasts a small "network-updated"
// message over WebSocket whenever a real mutation happens (an image gets
// assigned to a hospital, the agent generates or resolves an assessment).
// Rather than shipping duplicate data over the socket, this just tells
// React Query to refetch — the REST endpoints stay the single source of
// truth. Reconnects automatically with a fixed backoff if the connection
// drops.
const RECONNECT_DELAY_MS = 3000;

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting';

export function useRealtimeNetworkUpdates(): RealtimeStatus {
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    function connect() {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

      socket.onopen = () => {
        setStatus('connected');
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === 'network-updated') {
            void queryClientRef.current.invalidateQueries();
            toast({ title: 'Network updated', description: 'New data arrived from the federation — this view just refreshed.' });
          }
        } catch {
          // Ignore malformed messages rather than crashing the socket handler.
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return status;
}
