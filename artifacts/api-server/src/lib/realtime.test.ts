import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";

// Only Clerk's own network call is mocked (matching app.test.ts) — the
// WebSocket upgrade, auth gate, and broadcast fan-out below are the real
// production code path in realtime.ts.
let signedIn = true;
vi.mock("@clerk/express", () => ({
  clerkClient: {
    authenticateRequest: vi.fn(async () =>
      signedIn
        ? { status: "signed-in", toAuth: () => ({ userId: "user_test123" }) }
        : { status: "signed-out", toAuth: () => ({ userId: null }) },
    ),
  },
}));

const { initRealtime, broadcastNetworkUpdate } = await import("./realtime");

function startServer() {
  const server = createServer();
  initRealtime(server);
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

describe("realtime WebSocket", () => {
  it("rejects the upgrade when the caller is not signed in", async () => {
    signedIn = false;
    const { server, port } = await startServer();
    try {
      const rejection = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/api/ws`);
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("open", () => reject(new Error("connection should not have opened")));
      });
      expect(rejection).toBe(401);
    } finally {
      server.close();
    }
  });

  it("accepts the upgrade when signed in and delivers a real broadcast", async () => {
    signedIn = true;
    const { server, port } = await startServer();
    try {
      const ws = new WebSocket(`ws://localhost:${port}/api/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const messagePromise = new Promise<unknown>((resolve) => {
        ws.on("message", (data) => resolve(JSON.parse(data.toString())));
      });

      broadcastNetworkUpdate("chest-xray");

      const message = await messagePromise;
      expect(message).toEqual({ type: "network-updated", trackId: "chest-xray" });

      ws.close();
    } finally {
      server.close();
    }
  });
});
