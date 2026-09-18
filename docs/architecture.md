# Architecture, infrastructure, and required skill set

This document covers four things: the infrastructure this project runs on,
the system architecture, the algorithms/system-design concepts actually in
use, and — pulling all of that together — the role/seniority level and
technology list needed to build and maintain it. For the real-vs-simulated
boundary specifically, see [production-readiness.md](production-readiness.md).

---

## 1. Infrastructure

### Hosting topology

| Layer | Service | Purpose |
|---|---|---|
| API | Azure Container Apps (`<prefix><env>-api`) | Runs `artifacts/api-server` (Express) |
| Frontend | Azure Container Apps (`<prefix><env>-web`) | Serves `artifacts/federated-imaging-network` (static build via nginx) |
| Images | Azure Container Registry (Basic tier) | CI builds and pushes both service images here |
| Identity | User-assigned managed identity | Lets both Container Apps pull from ACR and read Key Vault secrets with no embedded credentials |
| Secrets | Azure Key Vault | Holds `postgres-admin-password`, `clerk-secret-key`, `agent-api-key` |
| Database | Azure Postgres Flexible Server (Burstable B1ms) | Real persisted data — tracks, nodes, overview, events, assessments |
| Observability | Log Analytics + Application Insights | Container Apps logs, API telemetry |

Provisioning is Infrastructure-as-Code via Bicep (`infra/azure/main.bicep` +
`main.bicepparam`) — compiled and validated, **not yet deployed** to a real
subscription. First deployment uses Microsoft's placeholder image until CI
pushes real images (see `infra/azure/README.md`).

### CI/CD

- `.github/workflows/ci.yml` — every push to `main` and every PR: install
  (frozen lockfile), typecheck, build. No test step yet.
- `.github/workflows/deploy-azure.yml` — `workflow_dispatch`-only (manual
  trigger, not automatic on merge). OIDC login to Azure (no long-lived
  client secret), builds and pushes both Docker images, then
  `az containerapp update` for both services.

### Local development infrastructure

- Postgres via Docker (`postgres:16-alpine`), single container, port
  `15432` on the host.
- The ML training service (`ml/federation-engine`) runs as its own Docker
  container, separately, with optional GPU passthrough
  (`--gpus all`) — entirely decoupled from the Node/Postgres stack; its
  only integration point is a JSON file (`output/results.json`) imported
  by a one-shot script.

### Environments

Documented (in `CLAUDE.md`/infra README) as dev/staging/production via
separate Azure resource groups per environment (different
`environmentName` Bicep parameter) — not yet actually split; only a
`dev` default exists today.

---

## 2. System architecture

### Modular monolith

One deployable Express process (`artifacts/api-server`), internally split
by domain folder (`routes/`, `middlewares/`, `lib/`) rather than by
service. The one domain router, `federation.ts`, owns every
network/node/event/agent endpoint; it does not get split into
sub-services because there's no independent-scaling need yet.

The ML training engine is the one deliberate exception: it's a **separate
Python process**, not folded into the monolith, because Node has no
practical way to run PyTorch training — the boundary is drawn at the
actual technology limit, not a scaling decision, and integration is a
file hand-off, not an API call.

### Contract-first API design

`lib/api-spec/openapi.yaml` is the single source of truth. Orval generates
two things from it:
- `lib/api-client-react` — a TanStack Query hook per endpoint, used by the
  frontend
- `lib/api-zod` — Zod schemas for every request/response shape, used by
  **both** sides

The Express handlers `.parse()` their own response against the generated
Zod schema before sending it. This means a contract violation is caught
at request time in production, not just at compile time — a stronger
guarantee than typical "trust the TypeScript types" API design.

### Auth architecture

- Clerk issues and verifies JWTs; `@clerk/express`'s `getAuth(req)` is read
  in `requireAuth.ts` middleware, which 401s if there's no authenticated
  `userId`.
- In production, `clerkProxyMiddleware.ts` proxies Clerk's Frontend API
  through `/api/__clerk` so Clerk works without custom-domain CNAME setup;
  it must be mounted before `express.json()` and buffers chunked upstream
  responses (some deploy edges reject chunked responses without an
  explicit `Content-Length`).

### Human-in-the-loop agent architecture

This is the most deliberate design decision in the system:

1. `POST /network/agent/assessments` runs a real LLM tool-use loop
   (`artifacts/api-server/src/lib/agent.ts`) with exactly three read-only
   tools (`get_network_overview`, `get_client_nodes`, `get_recent_events`)
   plus one mandatory terminal tool, `submit_assessment`.
2. The model can only *observe* — it has no tool that mutates anything.
3. Its output is Zod-validated before being persisted as a `pending`
   agent-assessment row.
4. Only a separate, human-triggered endpoint,
   `POST /network/actions/:actionId/resolve`, can move that row to
   `approved`/`dismissed` — and this is the only path that mutates status.
5. Deduplication: if a track already has a `pending` assessment, a new
   generation call returns the existing one instead of creating a second.

This is a specific, named pattern — **agentic action proposal with a
mandatory human approval gate** — chosen explicitly to keep an LLM out of
the write path for a system that (eventually) touches health data.

### Inference architecture (added most recently)

A second, separate real-computation path: `artifacts/api-server/src/lib/inference.ts`
loads a trained model as an ONNX Runtime session (`onnxruntime-node`),
preprocesses an uploaded image with `sharp` (resize to 28×28, grayscale,
normalize to `[0,1]` — matching training-time preprocessing exactly), and
runs a real forward pass. This is intentionally **not** an LLM call and
not simulated — it's a genuine inference request against the model
artifact that `ml/federation-engine` produced. It is explicitly documented
as a research-model classification, not a diagnostic one.

### Multi-tenancy model

Not tenant-per-gym/hospital in the strict sense yet — the "hospital sites"
are seeded simulated participants scoped by `trackId`, not independently
authenticated tenants. The intended real-world model (per the product's
own roadmap) is per-site identity and mTLS between a real hospital client
and the coordinator — documented as a gap, not implemented.

---

## 3. System design concepts and algorithms in use

### Federated learning (real, for one track)

- **FedAvg** (Federated Averaging) — the aggregation algorithm: each
  client trains locally on its own data, then the coordinator computes a
  weighted average of client model weights (`state_dict`), weighted by
  each client's sample count. Implemented directly in `run.py`, not via a
  framework (see below).
- **Non-IID data partitioning via a Dirichlet distribution** — clients are
  deliberately given *different* label distributions (not an i.i.d.
  random split), which is what makes the simulation representative of
  real hospitals (each hospital sees a different patient population mix),
  not an artificially easy uniform split.
- **Local SGD (Adam optimizer)** per client, per round, for a fixed number
  of local epochs before the next aggregation.
- **Held-out evaluation** — a test split never seen during any client's
  training, used to report the honest global AUROC/AUPRC/accuracy after
  each round.

**Why this was built as a direct implementation instead of using Flower**
(a purpose-built FL framework): Flower + Ray was tried first. At the
project's actual scale (3 simulated clients, one consumer GPU, Docker
Desktop on Windows), Ray's actor model spawned hundreds of worker
processes, pushed container memory past 2GB, and — worse — silently ran
training on CPU (0% GPU utilization) despite CUDA being available in the
driver process. This is a real, measured framework-overhead problem, not
a preference. The fix was to drop the framework and hand-write the
FedAvg loop directly (under 90 lines), which does the identical
computation with none of the process-spawning or serialization cost: 8
rounds across 3 clients in 19 seconds. The lesson generalizes: **a
framework's overhead is a function of the scale it was built for — below
that scale, a direct implementation can be both simpler and faster.**
Flower remains the right tool if this needs to scale to real, many,
physically distributed hospital clients later.

### Runtime contract validation

Not a machine learning concept, but a system-design one worth naming: this
project validates its own API contract at runtime (Zod `.parse()` on
every response, on both client and server, generated from one OpenAPI
spec) rather than relying solely on TypeScript's compile-time-only
guarantees. This catches drift between the spec and the implementation
that types alone cannot.

### Agentic tool-use with a bounded action space

The Federation Agent isn't a chatbot — it's an LLM given a small, fixed,
read-only tool set and a mandatory terminal action, with its output
schema-validated before persistence and no ability to mutate state
itself. This is the "tool-constrained agent with human approval gate"
pattern, distinct from open-ended agent frameworks that grant broad tool
access.

### Indexing / multi-tenant query pattern

Every collection carries a `trackId` scoping field, and query patterns
consistently filter by it — the same shape as a `gymId`/tenant-id
discriminator pattern in any shared-database multi-tenant system, applied
here to learning tracks instead of business tenants.

---

## 4. Role and technology requirements

See also the companion discussion already had in this session: **one
senior full-stack/ML-adjacent generalist** (or a very small team led by
one) is the right level for this project as it stands — the breadth
across web backend, frontend, LLM agent design, ML training, and cloud
infra in a single coherent codebase is a senior-generalist signature, not
a junior-scope task, and not yet large enough to need a full team.

### Required technology competence, by area

**Backend / API**
- Node.js, TypeScript, Express 5
- PostgreSQL + Drizzle ORM (schema design, `drizzle-kit push` migrations)
- Zod v4 for runtime validation
- OpenAPI spec authoring + Orval codegen workflow
- Middleware-chain API design (auth → role → ownership → handler)

**Auth & security**
- Clerk (JWT auth, custom claims, `@clerk/express` / `@clerk/react`)
- `helmet`, `express-rate-limit`
- Reverse-proxy patterns (Clerk Frontend API proxy for custom domains)

**AI / LLM integration**
- OpenAI-compatible SDK usage against Groq (or any compatible provider)
- Tool-use / function-calling agent design with a deliberately bounded
  tool set
- Designing for a human-approval gate around agent output, not
  autonomous action
- Structured/schema-validated LLM output

**Machine learning / federated learning**
- Python, PyTorch (writing training loops directly, not just calling a
  framework)
- FedAvg and the broader FL vocabulary (FedProx, FedOpt) — knowing when
  a framework like Flower is worth its overhead and when it isn't
- Non-IID data partitioning (Dirichlet), medical imaging task types
  (classification/segmentation/detection) and their standard metrics
  (AUROC, Dice, mAP)
- ONNX export/inference for serving a trained model outside the training
  environment

**Frontend**
- React, Vite, TypeScript
- TanStack Query against a generated API client
- Radix UI / shadcn-style components, Tailwind CSS
- `wouter` routing, Clerk React SDK

**Infra / DevOps**
- Docker (multi-stage builds, GPU passthrough for the ML container)
- Azure: Container Apps, ACR, Key Vault, Postgres Flexible Server, and
  Bicep specifically for IaC
- GitHub Actions, OIDC-based cloud auth (no long-lived secrets)
- pnpm workspaces (monorepo tooling)

**Domain/process literacy**
- HIPAA/compliance awareness — knowing what "not yet compliant" implies
  operationally, and where the real patient-data boundary must hold
- Privacy-preserving ML concepts (differential privacy, secure
  aggregation) even where not yet implemented, to know what's missing
  and why

### What would justify growing beyond one senior generalist

Per this project's own roadmap (`docs/production-readiness.md`), the
natural next specialist hires — not needed at the current demo/pilot
stage — would be:
- A dedicated ML engineer, once real training needs to scale past "3
  clients on one GPU" or cover the other two tracks (brain MRI, CT)
- A security/compliance specialist, before any real (even de-identified)
  patient data is allowed to touch the system
- A dedicated DevOps/infra person, once there are real staging/production
  environments to operate rather than one unreleased dev template
