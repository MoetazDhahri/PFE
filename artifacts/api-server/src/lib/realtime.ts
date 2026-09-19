import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { clerkClient } from "@clerk/express";
import { logger } from "./logger";

// Real-time push for the frontend: instead of duplicating every table over
// the wire, each connected client just gets told "something changed" and
// re-fetches via its existing TanStack Query hooks. This keeps a single
// source of truth (Postgres, read through the normal REST routes) instead
// of maintaining a second, socket-fed copy of the data model.

const WS_PATH = "/api/ws";
const clients = new Set<WebSocket>();

async function isAuthenticated(req: IncomingMessage): Promise<boolean> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  // Same-origin browser WebSocket connections carry the Clerk session
  // cookie automatically (the WebSocket constructor can't set custom
  // headers, so this relies on cookie-based auth working the same way it
  // already does for the app's other same-origin requests).
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const webRequest = new Request(url, { headers });

  const state = await clerkClient.authenticateRequest(webRequest);
  if (state.status !== "signed-in") return false;
  const auth = state.toAuth();
  return Boolean(auth.sessionClaims?.userId || auth.userId);
}

export function initRealtime(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== WS_PATH) return;

    isAuthenticated(req)
      .then((ok) => {
        if (!ok) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          clients.add(ws);
          ws.on("close", () => clients.delete(ws));
          ws.on("error", () => clients.delete(ws));
        });
      })
      .catch((err) => {
        logger.error({ err }, "WebSocket authentication failed");
        socket.destroy();
      });
  });

  logger.info({ path: WS_PATH }, "Real-time WebSocket endpoint ready");
}

export function broadcastNetworkUpdate(trackId: string): void {
  const payload = JSON.stringify({ type: "network-updated", trackId });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}
