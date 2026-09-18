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
| `GROQ_API_KEY` | only for agent assessments/Q&A | Federation Agent model calls |
| `GROQ_BASE_URL`, `AGENT_MODEL` | no | swap in any OpenAI-compatible provider/model (default `openai/gpt-oss-120b` via Groq) |
| `MODEL_ONNX_PATH` | only for `/network/inference` | path to the ONNX model exported by `ml/federation-engine` |
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
- **Federation Agent assessments** — an LLM observes aggregate telemetry (never raw imaging data) via three read-only tools and produces an "Action Value Card" recommending an action (e.g. hold a node's update before aggregation). A human must approve or dismiss it via `POST /network/actions/:actionId/resolve`; nothing the agent recommends takes effect automatically. `POST /network/events/:eventId/ask` lets an operator ask the agent a free-form question about a specific log entry, grounded in the same tools.
- **Academy / Knowledge Center** — in-app teaching content on federated-learning and ML concepts, each explicitly tagged `implemented`, `simulated`, or `reserved` so the UI never overstates what's actually running.
- **Real federated training, for 3 of the chest-xray track's 10 sites** — see [ML pipeline](#ml-pipeline) below.

Everything is scoped by learning track (`?track=`, default `chest-xray`) — chest X-ray classification, brain MRI segmentation, and CT lesion detection each have independent network state, nodes, and assessments.

## Stack

- **Workspace**: pnpm workspaces, Node.js 24, TypeScript 5.9
- **API**: Express 5 · auth via `@clerk/express` · `helmet` + `express-rate-limit` (120 req/min per client) · `pino` structured logging (redacts `authorization`/`cookie` headers)
- **DB**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Validation**: Zod v4 + `drizzle-zod` — every API response is `.parse()`d against the generated schema before being sent
- **API contract**: `lib/api-spec/openapi.yaml` is the single source of truth. Orval generates `lib/api-client-react` (TanStack Query hooks) and `lib/api-zod` (request/response schemas) from it — never hand-edit either, edit the spec and re-run codegen
- **Agent**: `openai` SDK against Groq by default, tool-use loop with three read-only tools plus a mandatory `submit_assessment` call
- **Frontend**: Vite + React, Radix/shadcn-style UI, TanStack Query, `wouter` routing, Clerk React SDK; served in production via nginx
- **ML**: standalone Python service under `ml/federation-engine` — direct PyTorch FedAvg (not Flower — see [ML pipeline](#ml-pipeline)) over a real, GPU-accelerated, Dirichlet-non-IID-partitioned training run; results are imported into Postgres via a one-shot script, not continuously wired in

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
ml/federation-engine/          standalone Python FL training service (not part of
                                the pnpm workspace/CI — see "ML pipeline" below)
  dataset.py                   PneumoniaMNIST loading + Dirichlet non-IID partition
  model.py                     small CNN (not the DenseNet-121 named in track metadata)
  train_utils.py               get/set params, local train loop, eval metrics
  run.py                       direct FedAvg loop (no Flower/Ray) — entrypoint
  output/results.json          written by a completed run; consumed by the import script
infra/azure/                   Bicep templates (Container Apps, ACR, Key Vault,
                                Postgres Flexible Server) — compiled, not yet deployed
docs/production-readiness.md   authoritative real-vs-simulated tracking doc
```

## Architecture decisions

- **Human-in-the-loop is structural, not a UI nicety.** The agent can only recommend via `submit_assessment`; only the `/resolve` endpoint (a human action) mutates an assessment's status.
- **Real vs. simulated is tracked explicitly**, not hidden. Every seeded/synthetic value is labeled as such in the Knowledge Center (`implemented` / `simulated` / `reserved` per concept) rather than presented uniformly. See [docs/production-readiness.md](docs/production-readiness.md) for the exact boundary.
- **OpenAPI-first codegen on both ends** — a contract change in `openapi.yaml` propagates to server-side runtime validation and client-side types together.
- **Clerk proxy for custom domains** — `clerkProxyMiddleware.ts` proxies Clerk's Frontend API through `/api/__clerk` in production so auth works without CNAME DNS setup; must be mounted before `express.json()`.
- **The ML training service is offline/one-shot, not live-wired.** `ml/federation-engine` produces a `results.json`; a separate script imports it into Postgres. There is no job scheduler, no "click a button to retrain" in the UI, and no automatic re-import. This was a deliberate scope decision, not an oversight — see [ML pipeline](#ml-pipeline).

## ML pipeline

`ml/federation-engine` is a real (not simulated) federated learning training run: a direct PyTorch FedAvg implementation — **not Flower/Ray**. Flower was tried first; its Ray-based actor model repeatedly caused severe process-spawning and object-store overhead on Windows/Docker/GPU-passthrough (2GB+ memory, hundreds of stray processes, minutes per round with 0% GPU utilization) that a ~40-line direct training loop simply doesn't have any surface for at this scale. Same real mechanics either way — real local SGD, real weighted parameter averaging, real held-out evaluation — just without the framework overhead.

What it actually does: partitions the real [PneumoniaMNIST](https://medmnist.com/) chest X-ray dataset across `NUM_CLIENTS` (currently 3, see `dataset.py`) simulated hospital clients using a Dirichlet non-IID label-skew split, runs `NUM_ROUNDS` (8) rounds of local training + FedAvg aggregation, and evaluates the final global model against a real held-out test set. A verified run: 8 rounds in **19 seconds** on a GTX 1650, loss 0.257 → 0.072, held-out test AUROC 0.921.

```bash
docker build -t fedimg-ml ml/federation-engine
docker run --rm --gpus all \
  -v "$(pwd)/ml/federation-engine/output:/app/output" \
  -v "$(pwd)/ml/federation-engine/data:/app/data" \
  fedimg-ml
# omit --gpus all to run on CPU (slower, still works — it's a tiny model)
```

This writes `ml/federation-engine/output/results.json`. Import it into the `chest-xray` track (requires `DATABASE_URL` pointed at your Postgres instance):

```bash
cd lib/db
DATABASE_URL="postgresql://..." pnpm run import-training-run ../../ml/federation-engine/output/results.json
```

The import updates `network_overview` and the `client_nodes` rows for whichever `NUM_CLIENTS` sites actually trained (site-1, site-2, ... in seed order) and inserts a real `activity_events` row — it does **not** touch the other sites, `brain-mri`, or `ct-lesion`, which remain synthetic. `totalSites` is deliberately preserved at its existing value (10), not overwritten with `NUM_CLIENTS` — only `connectedSites` reflects how many actually participated in a given run.

To scale back up to more clients, change `NUM_CLIENTS` in `dataset.py` — everything else (partitioning, training, import) is already parameterized on it. Extending real training to `brain-mri`/`ct-lesion` would mean wiring up a matching real dataset (an MRI or CT one) for each; nothing today does that.

## Architecture, infrastructure, and required skill set

See [docs/architecture.md](docs/architecture.md) for the full infrastructure topology, the system design patterns and algorithms actually in use (FedAvg, non-IID Dirichlet partitioning, the agentic tool-use/human-approval pattern, contract-first runtime validation), and the technology/role requirements to build and maintain this project.

## Current status

See [docs/production-readiness.md](docs/production-readiness.md) for the full breakdown. In short: auth, transport security, rate limiting, logging, Postgres persistence, the agent's assessment/Q&A calls, and real federated training for 3 of 10 chest-xray sites are real and verified end-to-end. Differential privacy/secure aggregation, per-site hospital identity, real training for the other tracks/sites, and any compliance or independent security review are not yet implemented — this platform does not handle real patient data, by design, until that changes.

## CI/CD

- `ci.yml` — runs on push to `main` and all PRs: `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build`. No automated test step yet.
- `deploy-azure.yml` — manual (`workflow_dispatch`) only, gated until Azure infra/secrets are provisioned.

## Gotchas

- Never hand-edit `lib/api-client-react` or `lib/api-zod` — regenerate from `lib/api-spec/openapi.yaml` via the `codegen` script. If you name a new component schema the same as orval's auto-derived `<operationId>Body`/`<operationId>Response` name, codegen fails with an "already exported a member" ambiguity error — give it a distinct name (e.g. `FooInput`/`FooResult` instead of `FooBody`/`FooResponse`) and re-run codegen.
- **This workspace is pinned to glibc Linux (`linux-x64-gnu`), not musl/Alpine.** `pnpm-workspace.yaml`'s `overrides` block deliberately strips out musl builds of `rollup`/`lightningcss`/etc. Building the frontend or api-server Docker images `FROM node:*-alpine` will fail with a "Cannot find module @rollup/rollup-linux-x64-musl" error — both Dockerfiles correctly use `node:*-slim` (Debian, glibc) for their build stage; don't change that. On native Windows (outside Docker), `pnpm run build` for the frontend will fail for the same class of reason (missing `@rollup/rollup-win32-x64-*`) — this is expected, build via Docker instead of trying to fix it with a local devDependency (that was tried and reverted; it fights the workspace's Linux-only policy).
- `ml/federation-engine` isn't part of the pnpm workspace, typecheck, or build pipeline — changes there won't be caught by `pnpm run typecheck`/`build`. There's also no Python typechecking/linting configured.
- `observedValueFor`/`outcomeFor` in `federation.ts` are template strings today, not a second model call — assessment *creation* and the ask-about-event endpoint are real LLM calls, but resolution-outcome text is not yet.
- Docker Desktop on Windows can silently degrade under sustained heavy load (multiple large image builds, GPU-passthrough containers) — commands start returning 500s or hanging. If that happens, restart Docker Desktop and run `docker builder prune -f` (stale build cache was the actual culprit both times this happened during development, not disk space from tagged images).
