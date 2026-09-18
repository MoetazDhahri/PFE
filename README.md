# Federated Imaging Network

A research/demo console for federated learning in medical imaging. Simulated hospital "client nodes" train on a medical-imaging task without sharing patient data, a global model aggregates their updates round by round, and an LLM "Federation Agent" watches telemetry and proposes actions that a human must explicitly approve before anything happens.

This is **not** a clinical or diagnostic tool, and does not currently handle real patient data — see [Current status](#current-status) below.

## Quick start

```bash
pnpm install
pnpm --filter @workspace/api-server run dev              # API server (default port 8080)
pnpm --filter @workspace/federated-imaging-network run dev # frontend (Vite dev server)
```

Required environment variables (`artifacts/api-server/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | yes | Clerk auth |
| `GROQ_API_KEY` | only for agent assessments | Federation Agent model calls |
| `GROQ_BASE_URL`, `AGENT_MODEL` | no | swap in any OpenAI-compatible provider/model (default `openai/gpt-oss-120b` via Groq) |
| `PORT`, `NODE_ENV` | no | server port, environment |

Other useful scripts:

```bash
pnpm run typecheck                                        # typecheck everything
pnpm run build                                             # typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen               # regenerate React Query client + Zod schemas from the OpenAPI spec
pnpm --filter @workspace/db run push                        # push DB schema changes (dev only)
```

## What it does

- **Network dashboard** — per learning-track federation health: round number/status, connected vs. total sites, global AUC/accuracy, privacy budget/status, model version.
- **Client nodes** — ~10 simulated hospital sites per track, each with region, imaging modality, status (online/attention/syncing), local AUC, data volume, and map coordinates.
- **Activity log** — timestamped events per track/round (actor, type, severity, optional node reference).
- **Federation Agent assessments** — an LLM observes aggregate telemetry (never raw imaging data) via three read-only tools and produces an "Action Value Card" recommending an action (e.g. hold a node's update before aggregation). A human must approve or dismiss it via `POST /network/actions/:actionId/resolve`; nothing the agent recommends takes effect automatically.
- **Academy / Knowledge Center** — in-app teaching content on federated-learning and ML concepts, each explicitly tagged `implemented`, `simulated`, or `reserved` so the UI never overstates what's actually running.

Everything is scoped by learning track (`?track=`, default `chest-xray`) — chest X-ray classification, brain MRI segmentation, and CT lesion detection each have independent network state, nodes, and assessments.

## Stack

- **Workspace**: pnpm workspaces, Node.js 24, TypeScript 5.9
- **API**: Express 5 · auth via `@clerk/express` · `helmet` + `express-rate-limit` (120 req/min per client) · `pino` structured logging (redacts `authorization`/`cookie` headers)
- **DB**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Validation**: Zod v4 + `drizzle-zod` — every API response is `.parse()`d against the generated schema before being sent
- **API contract**: `lib/api-spec/openapi.yaml` is the single source of truth. Orval generates `lib/api-client-react` (TanStack Query hooks) and `lib/api-zod` (request/response schemas) from it — never hand-edit either, edit the spec and re-run codegen
- **Agent**: `openai` SDK against Groq by default, tool-use loop with three read-only tools plus a mandatory `submit_assessment` call
- **Frontend**: Vite + React, Radix/shadcn-style UI, TanStack Query, `wouter` routing, Clerk React SDK; served in production via nginx
- **ML (not yet wired in)**: standalone Python service under `ml/federation-engine` — PyTorch + Flower, FedAvg simulation over 10 non-IID-partitioned clients

## Repo map

```
artifacts/
  api-server/                  Express backend
    src/routes/federation.ts   sole domain router — network/nodes/events/agent endpoints
    src/lib/agent.ts           Federation Agent tool-use loop
    src/middlewares/           requireAuth, Clerk frontend-API proxy
  federated-imaging-network/   React frontend
    src/pages/academy.tsx      Knowledge Center UI
    src/lib/academy-content.ts per-concept implemented/simulated/reserved status
lib/
  api-spec/openapi.yaml        API contract (source of truth)
  api-client-react/            generated TanStack Query client
  api-zod/                     generated Zod schemas/types
  db/src/schema/                Drizzle tables: learning-tracks, client-nodes,
                                network-overview, activity-events, agent-assessments
  db/src/seed.ts                seed data for the above
ml/federation-engine/          standalone Python FL simulation (not part of the
                                pnpm workspace/CI; not yet connected to the API/DB)
infra/azure/                   Bicep templates (Container Apps, ACR, Key Vault,
                                Postgres Flexible Server) — compiled, not yet deployed
docs/production-readiness.md   authoritative real-vs-simulated tracking doc
```

## Architecture decisions

- **Human-in-the-loop is structural, not a UI nicety.** The agent can only recommend via `submit_assessment`; only the `/resolve` endpoint (a human action) mutates an assessment's status.
- **Real vs. simulated is tracked explicitly**, not hidden. Node metrics and round numbers are currently seeded/simulated arithmetic. Real FL exists only as the disconnected `ml/federation-engine` Python service. See [docs/production-readiness.md](docs/production-readiness.md) for the exact boundary and the current verified-live behavior of the agent.
- **OpenAPI-first codegen on both ends** — a contract change in `openapi.yaml` propagates to server-side runtime validation and client-side types together.
- **Clerk proxy for custom domains** — `clerkProxyMiddleware.ts` proxies Clerk's Frontend API through `/api/__clerk` in production so auth works without CNAME DNS setup; must be mounted before `express.json()`.

## Current status

See [docs/production-readiness.md](docs/production-readiness.md) for the full breakdown. In short: auth, transport security, rate limiting, logging, Postgres persistence, and the agent's initial assessment call are real and verified end-to-end. Real federated training, differential privacy/secure aggregation, per-site hospital identity, and any compliance or independent security review are not yet implemented — this platform does not handle real patient data, by design, until that changes.

## CI/CD

- `ci.yml` — runs on push to `main` and all PRs: `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build`. No automated test step yet.
- `deploy-azure.yml` — manual (`workflow_dispatch`) only, gated until Azure infra/secrets are provisioned.

## Gotchas

- Never hand-edit `lib/api-client-react` or `lib/api-zod` — regenerate from `lib/api-spec/openapi.yaml` via the `codegen` script.
- `ml/federation-engine` isn't part of the pnpm workspace, typecheck, or build pipeline — changes there won't be caught by `pnpm run typecheck`/`build`.
- `observedValueFor`/`outcomeFor` in `federation.ts` are template strings today, not a second model call — assessment *creation* is a real LLM call, but resolution-outcome text is not yet.
