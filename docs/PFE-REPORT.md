# PFE Report Source Material — Federated Imaging Network

This document organizes the project's real content into the standard PFE
(Projet de Fin d'Études) report structure. It is source material to adapt
into your final report — the section headings follow the conventional
outline; the content under each is drawn directly from this codebase and
its own documentation (`README.md`, `docs/architecture.md`,
`docs/production-readiness.md`), not invented. Passages you should expand
in your own words are marked _[expand]_; passages that are already
report-ready prose are left as-is for you to adapt to your institution's
formatting requirements (cover page, abstract length, citation style,
etc., which this document does not attempt to supply).

---

## Abstract _[expand — 200–300 words, written last]_

State, in the report's target language: the problem (hospitals cannot
pool medical imaging data to train better diagnostic models, due to
privacy/regulatory constraints), the proposed approach (a federated
learning coordination platform where hospitals train locally and only
share model updates), what was actually built (a full-stack web platform
plus a working federated averaging training pipeline validated on a real
dataset), and the headline result (a real FedAvg run achieving 0.921
AUROC on held-out data without centralizing any patient data). Close with
one sentence on scope/limitations (research prototype, not a certified
clinical or production system).

---

## 1. Introduction

### 1.1 Context

Medical imaging AI models improve with more, and more diverse, training
data. In practice, hospitals cannot pool raw patient imaging data across
institutions — legal (HIPAA and equivalents), ethical, and competitive
constraints prevent centralizing that data even when doing so would
produce a better model. **Federated learning (FL)** is the standard
answer to this constraint: each institution trains a model on its own
local data, and only the resulting model *updates* — not the underlying
images — are shared with a coordinator that aggregates them into a
single, improved global model. No raw patient data ever leaves the
institution that owns it.

### 1.2 Problem statement _[expand]_

State the specific gap this project addresses: existing FL research
tooling (e.g. Flower) targets either pure research simulation or
large-scale production deployment, but there is a gap for a small,
observable, operator-facing coordination platform that a non-specialist
site administrator could actually watch and act on — with humans kept
firmly in the loop over what an automated system is allowed to decide
alone. This project's specific contribution is that human-in-the-loop
layer combined with a working, verified FL training pipeline.

### 1.3 Objectives

- Build a federation coordination platform (web dashboard + API) that
  gives visibility into per-hospital-site training status, without ever
  centralizing imaging data.
- Implement and verify a real (not simulated) federated averaging
  training pipeline on a genuine medical imaging dataset.
- Design and implement a constrained, auditable AI agent that observes
  federation telemetry and proposes operational actions, with a mandatory
  human-approval gate before any action takes effect.
- Provide a working real-model inference path so a trained federated
  model can actually be queried, demonstrating the full loop from
  distributed training to a usable prediction.
- Document, explicitly and honestly, which parts of the system are
  production-grade versus simulated/research-stage — treated as a design
  requirement, not an afterthought (see Section 6, Limitations).

### 1.4 Scope

In scope: the coordination platform, the FedAvg training pipeline for
one imaging modality (chest X-ray), the human-approval agent workflow,
ONNX-based model inference, and cloud infrastructure design (not
deployment). Out of scope, and explicitly documented as such: real
differential privacy/secure aggregation, multi-site cryptographic
identity/mTLS, real training for the other two imaging modalities
(brain MRI, CT), and any compliance certification (HIPAA/SOC 2).

---

## 2. State of the art / related work _[expand]_

This section is where you position the project against existing FL
research and tooling. Suggested structure and what to say about each:

- **Federated Averaging (FedAvg)** — McMahan et al., 2017, the
  foundational algorithm this project implements directly. Explain the
  algorithm here (local SGD per client, weighted parameter averaging by
  client sample count) since Section 4 will reference it as
  "implemented," not re-derive it.
- **FedProx / FedOpt** — mentioned in this project's product design as
  algorithms for the other two tracks (brain MRI, CT) but not yet
  implemented; cite them as the intended future direction and briefly
  explain how they differ from FedAvg (FedProx adds a proximal term for
  client heterogeneity; FedOpt generalizes the server-side aggregation
  step to adaptive optimizers).
- **Flower / Ray** — the FL simulation framework this project initially
  adopted and then deliberately dropped. This is worth a real subsection
  (see 4.4) because it's a genuine, measured engineering finding, not
  just a tooling choice — cite Flower's own documentation/paper as the
  framework being evaluated, and present the measured overhead (Section
  4.4) as this project's own contribution to understanding where the
  framework's overhead model breaks down.
- **Differential privacy / secure aggregation in FL** — cite the general
  literature (e.g. Bonawitz et al. on secure aggregation, Abadi et al. on
  differentially private SGD) as the acknowledged gap this project does
  not close (Section 6).
- **Non-IID data in FL** — cite work on label-skew/Dirichlet partitioning
  as the standard way to simulate realistic (non-uniform) client data
  distributions, which this project actually implements (Section 4.2).

---

## 3. System requirements

### 3.1 Functional requirements

- Display per-track (imaging modality) federation status: round number,
  connected vs. total sites, global metric (AUROC/Dice/mAP depending on
  track), privacy budget/status, model version.
- Display per-site status: region, imaging modality, connection status,
  local metric, data volume.
- Maintain an auditable activity log of federation events (aggregation,
  client updates, privacy checks, round transitions).
- Generate AI-assisted operational recommendations ("Action Value
  Cards") from live telemetry, with mandatory human approval/dismissal
  before any recorded outcome.
- Allow an operator to ask a free-form, tool-grounded question about a
  specific log entry.
- Run a real federated training job and import its results into the
  platform's database.
- Serve real inference requests against the trained model.
- Provide an in-app "Knowledge Center" teaching FL/ML concepts, each
  explicitly labeled by implementation status.

### 3.2 Non-functional requirements

- Every document/table scoped to a tenant discriminator (`trackId`) to
  prevent cross-track data leakage, enforced structurally rather than by
  convention in every handler.
- API contract enforced at runtime (not compile-time only) on both
  client and server, via a single OpenAPI specification.
- Authentication verified server-side on every request; no
  client-side-only authorization check.
- Rate limiting and security headers on all API traffic.
- Secrets never embedded in deployment manifests (managed identity +
  vault-based secret access, once deployed).

### 3.3 Actors

- **Operator / federation administrator** — the primary user of the
  dashboard; reviews and approves/dismisses agent recommendations.
- **Federation Agent** — the LLM-driven observer with strictly read-only
  access to telemetry, never a write path.
- **Simulated hospital client sites** — the participating nodes in each
  learning track (real for 3 of 10 chest-X-ray sites; simulated for the
  rest).

---

## 4. System design and implementation

### 4.1 High-level architecture

_[expand with a diagram — see `docs/architecture.md` §2 for the prose
description to draw from]_

The system is a **modular monolith**: one Express process
(`artifacts/api-server`) internally organized by domain (routes,
middleware, business logic) rather than split into microservices, since
independent scaling is not yet a real requirement. The one deliberate
exception is the machine learning training component
(`ml/federation-engine`), which runs as a fully separate Python process —
not because of a scaling decision, but because the technology itself
(PyTorch training) has no practical place inside a Node.js process. That
component communicates with the main system through a file hand-off (a
results file consumed by a one-shot import script), not a live API call —
a deliberate, documented scope boundary rather than an oversight.

The frontend is a separate React single-page application, communicating
with the API through a client generated from the same OpenAPI
specification the server validates against — see 4.3.

### 4.2 The federated learning pipeline

This is the technical core of the project and should be the most detailed
section of your report.

**Dataset.** PneumoniaMNIST, a real, publicly available chest X-ray
dataset for binary pneumonia-versus-normal classification, loaded via the
`medmnist` package — chosen to match the "chest-xray" track's declared
clinical task.

**Data partitioning.** Rather than splitting the dataset identically and
randomly across simulated clients (an unrealistically easy i.i.d. split),
the dataset is partitioned using a **Dirichlet distribution** to create
genuine **non-IID label skew** — each simulated hospital client ends up
with a meaningfully different distribution of pneumonia-vs-normal cases,
which is what actually happens across real hospitals with different
patient populations. This is the harder, more realistic version of the FL
problem, and demonstrating it work explains why the local/global metric
gap in the results (4.5) is a real signal, not noise.

**Local training.** Each client runs local SGD (Adam optimizer) on its
own partition for a fixed number of local epochs before its updated
weights are sent to the coordinator for aggregation.

**Aggregation — Federated Averaging (FedAvg).** The coordinator computes
a weighted average of the client model weights (`state_dict`), weighted
by each client's sample count, replacing the global model with this
average before the next round begins. Implemented directly (see 4.4 for
why), the full loop is under 90 lines: parameter extraction, local train,
weighted average, held-out evaluation, repeated for a fixed number of
rounds.

**Evaluation.** After aggregation, the global model is evaluated against
a held-out test split that no client ever trains on, reporting AUROC,
AUPRC, and accuracy — the honest, generalization-representative metric,
not a metric computed on training data.

**Model.** A small custom convolutional neural network (2 convolution +
pooling layers, 2 fully connected layers, 28×28 grayscale input, 2-class
output) — explicitly not the DenseNet-121 the platform's track metadata
names as its target architecture, a compute-budget tradeoff you should
state plainly in your report as a scoping decision (one consumer GPU, not
a cluster), not an unnoticed gap.

### 4.3 Contract-first API design

The system's API contract is defined once, in a single OpenAPI
specification (`lib/api-spec/openapi.yaml`), and code generation (via
Orval) derives two artifacts from it: a typed React Query client for the
frontend, and Zod runtime-validation schemas used on **both** the client
and the server. Critically, the server validates its own response
against the generated schema before sending it — meaning a contract
violation is caught at request time in production, a stronger guarantee
than relying on TypeScript's compile-time-only type checking. This is
worth presenting as a deliberate system-design choice: schema-driven
development with enforcement at the boundary, not just documentation of
intent.

### 4.4 Why Flower/Ray was replaced with a direct implementation

This subsection documents a genuine engineering finding worth including
in full, since it demonstrates engineering judgment, not just following a
tutorial:

The project initially implemented its FL training loop using **Flower**,
a purpose-built federated learning simulation framework, with **Ray** as
its distributed execution backend. On the project's actual development
environment (Windows, Docker Desktop, GPU passthrough), this proved
unworkable in practice, for measured — not assumed — reasons:

- Ray's actor model spawned hundreds of worker processes for as few as
  three logical simulated clients, pushing container memory past 2 GB and
  causing the Docker runtime itself to degrade under load (failed
  commands, unresponsive daemon).
- Despite the driver process correctly detecting an available GPU,
  training inside the Ray worker processes silently ran on CPU — 0% GPU
  utilization was observed — making a single round take multiple minutes.
- The standard fix (lazy, per-worker data loading instead of eager
  loading) reduced but did not resolve the problem, because Ray
  re-spawned fresh worker processes per task rather than reusing them,
  defeating the per-process cache.

The response was to remove the framework entirely and hand-write the
FedAvg loop directly — the same real computation (real local SGD, real
weighted averaging, real held-out evaluation), with none of the
process-spawning or serialization overhead. The measured result: **8
rounds across 3 clients complete in 19 seconds** on a consumer GPU (GTX
1650), versus multiple minutes per round previously.

The generalizable conclusion, worth stating explicitly in your report: a
simulation framework's overhead is proportional to the scale it is
designed for; below that scale, a direct implementation can be both
simpler to reason about and faster in practice. Flower remains the
correct tool if this system needs to scale to genuinely many,
independently operated hospital clients across real network boundaries —
a scale this project does not yet operate at.

### 4.5 Results

Report these as the headline quantitative results:

- Training loss decreased from **0.257 to 0.072** over 8 FedAvg rounds.
- Held-out test set AUROC: **0.921** (on 624 images never seen during
  training).
- Wall-clock training time: **~19 seconds** for the full 8-round,
  3-client run, on a single consumer GPU.

_[expand: include the actual loss/accuracy curve per round from a run —
regenerate with `docker run` per `ml/federation-engine/README.md` if you
want fresh numbers, or use the numbers already recorded in
`docs/production-readiness.md` and `ml/federation-engine/output/results.json`
if that file is present in your working copy]_

### 4.6 The human-in-the-loop AI agent

Beyond the FL pipeline itself, the platform includes an LLM-driven
"Federation Agent" designed around a specific, named architectural
pattern worth its own subsection: **agentic action proposal with a
mandatory human approval gate**. The agent is given exactly three
read-only tools (query network overview, query client nodes, query recent
events) and one mandatory terminal tool (submit a structured assessment).
It has no tool that can mutate any state. Its structured output is
schema-validated before being stored as a "pending" recommendation; only
a separate, explicitly human-triggered action can move that
recommendation to "approved" or "dismissed." This was verified working
end-to-end against real seeded data: the agent correctly identified a
flagged node by name from live tool results and produced a schema-valid
recommendation citing which tool each piece of evidence came from.

This pattern is worth framing in your report as a direct answer to a
known risk in agentic AI systems generally — giving a language model
unconstrained write access to production state — solved here by
constraining the tool surface at the design level rather than trusting
the model's judgment about what it should or shouldn't do.

### 4.7 Model inference

To close the loop from "trained model" to "usable prediction," the
platform exposes a real inference endpoint: an uploaded chest X-ray image
is preprocessed (resized to 28×28, converted to grayscale, normalized to
match training-time preprocessing exactly) and passed through the trained
model — exported to the ONNX format — via ONNX Runtime, returning a real
prediction with confidence. This is explicitly not a diagnostic device;
it demonstrates the technical pipeline end-to-end, not a clinically
validated classifier.

---

## 5. Technology stack _[reference — see `docs/architecture.md` §4 for full detail]_

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express 5 |
| Database | PostgreSQL, Drizzle ORM |
| API contract | OpenAPI 3, Orval codegen, Zod v4 runtime validation |
| Authentication | Clerk (JWT-based) |
| AI agent | OpenAI-compatible SDK against Groq (`openai/gpt-oss-120b`) |
| Machine learning | Python, PyTorch, ONNX Runtime |
| Frontend | React, Vite, TanStack Query, Tailwind CSS |
| Infrastructure | Docker, Azure Container Apps, Azure Key Vault, Azure Postgres Flexible Server, Bicep (IaC) |
| CI/CD | GitHub Actions |

---

## 6. Limitations and honesty about scope

A distinguishing feature of this project, worth presenting explicitly
rather than glossing over: every simulated or research-stage component is
documented as such in the codebase itself
(`docs/production-readiness.md`, and per-concept status tags in the
in-app Knowledge Center), not just in this report. State clearly in your
report:

- **No real differential privacy or secure aggregation** — the privacy
  budget and status shown are static display values, not the output of a
  privacy accountant.
- **Real training covers only 3 of 10 sites, one of three imaging
  modalities.** The other 7 chest-X-ray sites and both other tracks
  (brain MRI, CT) remain fully synthetic; no matching real dataset is
  wired up for them.
- **No independent security review or compliance certification**
  (HIPAA, SOC 2) has been performed; this system does not, and by design
  should not, handle real patient data until that changes.
- **The agent's initial recommendation is a real model call; its
  recorded resolution outcome is currently a template string**, not a
  second model call — there is no subsequent real training round yet to
  observe a genuine outcome from.
- **Single-tenant simulated identity** — hospital sites are seed data,
  not independently authenticated services; per-site cryptographic
  identity is a documented future requirement, not implemented.

Presenting these limitations precisely, rather than either hiding them or
over-qualifying every claim, is itself a demonstration of engineering
maturity worth calling out to your jury.

---

## 7. Conclusion and future work

### 7.1 Conclusion _[expand]_

Summarize: a working federation coordination platform was built with a
verified, real (not simulated) federated averaging training pipeline,
demonstrating that a small-scale, realistically non-IID FL system can be
implemented directly — without a heavyweight simulation framework — when
operating below the scale that framework was designed for. The
human-in-the-loop agent design demonstrates a concrete pattern for
constraining LLM-driven automation in a domain where unattended action is
unacceptable.

### 7.2 Future work

Directly from this project's own documented roadmap
(`docs/production-readiness.md`), in priority order:

1. Independent security review of the authentication flow, secret
   management, and network isolation once deployed.
2. Real privacy-preserving aggregation (differential privacy and/or
   secure aggregation), itself independently reviewed before being
   presented as production-capable.
3. Per-site cryptographic identity and connectivity model for genuine,
   physically distributed hospital clients (replacing simulated sites).
4. A formal data-processing agreement / legal basis before any real
   (even de-identified) patient data is permitted to touch the system.
5. Extending real (not simulated) training to the remaining chest-X-ray
   sites and to the brain MRI / CT tracks, which requires sourcing a
   matching real dataset for each.
6. A second, real model call for the agent's resolution-outcome text,
   once there is a genuine subsequent training round to observe an
   outcome from.

---

## Appendix

- Full technology/role breakdown: `docs/architecture.md`
- Full real-vs-simulated tracking: `docs/production-readiness.md`
- ML pipeline details and how to reproduce the training run:
  `ml/federation-engine/README.md`
- Azure infrastructure template and deployment steps: `infra/azure/README.md`
- API contract: `lib/api-spec/openapi.yaml`
