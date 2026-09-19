import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientNodesTable, db, generateNodeApiKey, hashNodeApiKey } from "@workspace/db";

// These hit the federation router directly (no auth middleware, matching
// how routes/index.ts wires it — auth is covered separately in
// app.test.ts) against a real Postgres instance. Requires DATABASE_URL to
// point at a reachable database with the seeded schema (see
// lib/db/src/seed.ts); skips instead of failing when that's not available,
// since this suite runs outside Docker too.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_NODE_ID = "test-node-federation-spec";
const TEST_NODE_KEY = generateNodeApiKey();

describeIfDb("federation routes (integration)", () => {
  beforeAll(async () => {
    await db.insert(clientNodesTable).values({
      id: TEST_NODE_ID,
      trackId: "chest-xray",
      name: "Test Hospital",
      shortName: "TEST",
      region: "Testland",
      modality: "Radiology",
      status: "online",
      dataVolume: 0,
      localAuc: 0.9,
      privacyStatus: "protected",
      lastSeen: new Date(),
      x: 0,
      y: 0,
      apiKeyHash: hashNodeApiKey(TEST_NODE_KEY),
    });
  });

  afterAll(async () => {
    await db.delete(clientNodesTable).where(eq(clientNodesTable.id, TEST_NODE_ID));
  });

  it("GET /network/overview returns the seeded chest-xray track", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/network/overview").query({ track: "chest-xray" });
    expect(res.status).toBe(200);
    expect(res.body.trackId).toBe("chest-xray");
  });

  it("POST /network/inference rejects non-image bytes with 400", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app)
      .post("/api/network/inference")
      .send({ imageBase64: Buffer.from("this is not an image").toString("base64") });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/could not/i);
  });

  it("POST /network/inference rejects an unknown hospital node id with 404", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app)
      .post("/api/network/inference")
      .send({ imageBase64: Buffer.from("garbage").toString("base64"), nodeId: "does-not-exist" });

    expect(res.status).toBe(404);
  });

  it("POST /network/inference rejects a real node id with no API key with 403", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app)
      .post("/api/network/inference")
      .send({ imageBase64: Buffer.from("garbage").toString("base64"), nodeId: TEST_NODE_ID });

    expect(res.status).toBe(403);
  });

  it("POST /network/inference rejects a real node id with the wrong API key with 403", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).post("/api/network/inference").send({
      imageBase64: Buffer.from("garbage").toString("base64"),
      nodeId: TEST_NODE_ID,
      nodeApiKey: "definitely-the-wrong-key",
    });

    expect(res.status).toBe(403);
  });

  it("POST /network/inference accepts a real node id with its real API key (rejecting only on image validity)", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).post("/api/network/inference").send({
      imageBase64: Buffer.from("garbage").toString("base64"),
      nodeId: TEST_NODE_ID,
      nodeApiKey: TEST_NODE_KEY,
    });

    // The right key clears the auth gate entirely — the garbage image bytes
    // then fail *image* validation (400), not the API key check (403).
    expect(res.status).toBe(400);
  });

  it("GET /network/training-rounds returns rounds ordered ascending", async () => {
    const { default: router } = await import("./federation");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/network/training-rounds").query({ track: "chest-xray" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const rounds = res.body.map((r: { round: number }) => r.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  });
});
