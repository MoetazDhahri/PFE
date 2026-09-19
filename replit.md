# Federated Imaging Network

A demo/research console for federated learning in medical imaging: simulated hospital "client nodes" train on chest X-ray, brain MRI, or CT tasks without sharing patient data, a global model aggregates their updates round by round, and an LLM "Federation Agent" watches telemetry and proposes actions that a human must approve before anything happens.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080 by default)
- `pnpm --filter @workspace/federated-imaging-network run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate the React Query client (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env (`artifacts/api-server/.env.example`): `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`; `GROQ_API_KEY` required only to call the agent-assessment endpoint (optional `GROQ_BASE_URL`, `AGENT_MODEL` to point at a different OpenAI-compatible provider); `PORT`, `NODE_ENV`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, auth via `@clerk/express` (`requireAuth` middleware), `helmet` + `express-rate-limit`, `pino` logging
- DB: PostgreSQL + Drizzle ORM (`lib/db`)
- Validation: Zod v4 + `drizzle-zod`; the API server `.parse()`s every response against the generated Zod schemas before sending it — contract enforcement at runtime, not just compile time
- API contract: `lib/api-spec/openapi.yaml` is the single source of truth; Orval generates both `lib/api-client-react` (TanStack Query hooks) and `lib/api-zod` (request/response schemas) from it
- Agent: `openai` SDK against Groq by default (`openai/gpt-oss-120b`), tool-use loop with three read-only tools plus a mandatory `submit_assessment` call
- Frontend: Vite + React, Radix/shadcn-style UI, TanStack Query, `wouter` routing, Clerk React SDK; served in production via nginx (not Vite's server)
- Build: esbuild (bundles API server to `dist/index.mjs`)
- ML: standalone Python service under `ml/federation-engine` — direct PyTorch FedAvg (not Flower/Ray — that was tried and dropped after severe process-spawning overhead on this Docker/GPU setup) over a real, GPU-accelerated, Dirichlet-non-IID-partitioned PneumoniaMNIST training run (3 clients, 8 rounds, ~19s); a one-shot script imports the result into Postgres, replacing seeded numbers for 3 of the chest-xray track's 10 sites

## Where things live

- `artifacts/api-server` — Express backend. `src/routes/federation.ts` is the sole domain router (all federation/network/agent endpoints); `src/lib/agent.ts` is the Federation Agent tool-use loop; `src/middlewares/requireAuth.ts` and `clerkProxyMiddleware.ts` handle auth.
- `artifacts/federated-imaging-network` — React frontend. `src/pages/academy.tsx` + `src/lib/academy-content.ts` are the "Knowledge Center" that teaches FL/ML concepts and tags each one `implemented | simulated | reserved`.
- `lib/api-spec/openapi.yaml` — source of truth for the API contract.
- `lib/api-client-react`, `lib/api-zod` — generated from the OpenAPI spec via Orval; never hand-edit, regenerate with the `codegen` script.
- `lib/db/src/schema` — Drizzle table definitions: `learning-tracks`, `client-nodes`, `network-overview`, `activity-events`, `agent-assessments`.
- `ml/federation-engine` — standalone Python FL training service (direct PyTorch, not Flower — see its own README), isolated from the pnpm workspace and CI; feeds real training results into the DB via `lib/db/src/import-training-run.ts`, one-shot/manual, not continuously wired in.
- `infra/azure` — Bicep templates for Azure Container Apps, ACR, Key Vault, Postgres Flexible Server; compiled but not yet deployed to a real subscription.
- `docs/production-readiness.md` — the authoritative "what's real vs. simulated" changelog; keep in sync with `academy-content.ts` status tags when wiring in new pieces.

## Architecture decisions

- **Human-in-the-loop is structural, not a UI nicety**: the agent can only recommend via `submit_assessment`; only `POST /network/actions/{id}/resolve` (a human action) mutates an assessment's status. Nothing the agent proposes takes effect automatically.
- **Simulated vs. real is tracked explicitly**: most node metrics and round numbers are seeded/simulated arithmetic, not output of real training — except 3 of the chest-xray track's 10 sites, which now come from a real completed `ml/federation-engine` training run imported via a manual script. This boundary is deliberately visible to users via the Academy's per-concept status tags, not hidden.
- **Everything is scoped by learning track** (`?track=`, default `chest-xray`): chest X-ray classification, brain MRI segmentation, CT lesion detection each have independent network state, nodes, and assessments.
- **OpenAPI-first codegen on both ends**: the Express routes and the React frontend both consume generated types from the same spec, so a contract change in `openapi.yaml` propagates to server-side runtime validation and client-side types together.
- **Clerk proxy for custom domains**: `clerkProxyMiddleware.ts` proxies Clerk's Frontend API through `/api/__clerk` in production so Clerk works without CNAME DNS setup on the Azure Container Apps deployment; must be mounted before `express.json()`.

## Product

- **Network dashboard**: per-track federation health — round number/status, connected vs. total sites, global AUC/accuracy, privacy budget/status, model version.
- **Client nodes**: ~10 simulated hospital sites per track with region, imaging modality, status (online/attention/syncing), local AUC, data volume, map coordinates.
- **Activity log**: timestamped events per track/round (actor, type, severity, optional node reference).
- **Federation Agent assessments**: an LLM observes aggregate telemetry (never raw imaging data) and produces an "Action Value Card" recommending an action (e.g., hold a node's update before aggregation); a human approves or dismisses it. `POST /network/events/{id}/ask` also lets an operator ask the agent a free-form question about a specific log entry.
- **Academy / Knowledge Center**: in-app teaching content on FL and ML concepts, each honestly labeled as implemented, simulated, or reserved for later.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- No test step exists in CI yet (`ci.yml` only runs typecheck + build).
- `deploy-azure.yml` is `workflow_dispatch`-only and gated until Azure secrets/infra are actually provisioned — don't expect push-to-deploy.
- Never hand-edit `lib/api-client-react` or `lib/api-zod` — they're generated from `lib/api-spec/openapi.yaml`; edit the spec and re-run codegen.
- `ml/federation-engine` is not part of the pnpm workspace, typecheck, or build pipeline — it won't be caught by `pnpm run typecheck`/`build`, and importing a training run into Postgres is a manual step (`pnpm --filter @workspace/db run import-training-run <path>`), not automatic.
- `agent.ts`'s `observedValueFor`/`outcomeFor` are template strings today, not a second real model call — don't assume assessment text reflects live computation beyond what `submit_assessment`/`ask` returned.
- This workspace is pinned to glibc Linux (`linux-x64-gnu`) via `pnpm-workspace.yaml` overrides — building either app Dockerfile `FROM node:*-alpine` (musl) fails; both correctly use `node:*-slim`. Don't change that.
- Docker Desktop on Windows can degrade under sustained heavy load (500 errors, hung commands) — restart it and run `docker builder prune -f` (stale build cache, not disk space, was the actual cause both times this happened during development).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- `docs/production-readiness.md` for the current real-vs-simulated boundary and roadmap.
