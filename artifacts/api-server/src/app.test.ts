import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// The real clerkMiddleware needs a live Clerk instance to validate session
// tokens against; for these smoke tests we only care that requests without
// any session are rejected, and that public routes (like /healthz) aren't
// gated at all. Stub it out with the same shape (req.auth) requireAuth reads.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (req: any, _res: any, next: any) => {
    req.auth = () => ({ userId: null, sessionClaims: null });
    next();
  },
  getAuth: (req: any) => (typeof req.auth === "function" ? req.auth() : req.auth),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_stub",
}));

const { default: app } = await import("./app");

describe("app smoke tests", () => {
  it("GET /api/healthz responds ok without authentication", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/network/overview requires authentication", async () => {
    const res = await request(app).get("/api/network/overview");
    expect(res.status).toBe(401);
  });

  it("POST /api/network/inference requires authentication", async () => {
    const res = await request(app).post("/api/network/inference").send({ imageBase64: "" });
    expect(res.status).toBe(401);
  });
});
