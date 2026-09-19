# Production readiness and security limitations

This document tracks the gap between what this repository currently does
and what would be required to operate it against real hospital data. It
should be updated whenever a "reserved" item in the
[Knowledge Center](../artifacts/federated-imaging-network/src/lib/academy-content.ts)
moves to "implemented." Nothing described here should be read as a
certification, compliance attestation, or clinical validation.

## What's real today

- **Authentication**: Clerk-issued JWTs verified server-side on every
  request via `@clerk/express`; the frontend never trusts a client-side
  role check alone.
- **Transport security headers**: `helmet()` sets a default-deny CSP,
  HSTS, frame-ancestors, and related headers on every API response.
- **Rate limiting**: 120 requests/minute per client on the API, via
  `express-rate-limit`.
- **Structured, redacted logging**: `pino` redacts `authorization` and
  `cookie` headers before they reach logs.
- **Secrets handling (once deployed via `infra/azure/`)**: Postgres admin
  password and Clerk secret key live in Key Vault, referenced by Container
  Apps via managed identity — never as plain environment variables in a
  deployment manifest.
- **Human approval on every agent action**: nothing an agent recommends
  takes effect until a human explicitly approves it (`artifacts/api-server/src/routes/federation.ts`,
  `POST /network/actions/:actionId/resolve`).
- **Real persistence.** Tracks, client nodes, network overview, activity
  events, and agent assessments/history are Postgres tables via
  `@workspace/db` (Drizzle) — verified end-to-end against a live Postgres
  instance, including the resolve-and-record-outcome flow. State survives a
  server restart. Schema lives in `lib/db/src/schema/`, seed data in
  `lib/db/src/seed.ts`.
- **Real agent reasoning.** `POST /network/agent/assessments`
  (`artifacts/api-server/src/lib/agent.ts`) runs a real model call (Groq's
  OpenAI-compatible API, `openai/gpt-oss-120b` by default — swappable to any
  OpenAI-compatible endpoint via `GROQ_BASE_URL`/`AGENT_MODEL`) with tool
  use: the model can only call three read-only queries (network overview,
  client nodes, recent events) against the live database before it must
  call `submit_assessment`, whose output is schema-validated before being
  stored. Verified live, end-to-end, against real Postgres data: the model
  correctly identified the seeded "attention"-status node by name from
  actual tool results and produced a coherent, schema-valid Action Value
  Card citing which tool each evidence item came from. Guard rails also
  verified: no duplicate generation while a card is already pending, and a
  clean, typed error when `GROQ_API_KEY` is missing.
- **Real federated training, for 3 of the chest-xray track's 10 sites.** A
  PyTorch job at `ml/federation-engine/` runs a direct FedAvg
  implementation — not Flower/Ray; that was tried first and dropped after
  it repeatedly caused severe process-spawning and object-store overhead
  on this Windows/Docker/GPU-passthrough setup (2GB+ memory, hundreds of
  PIDs, minutes per round with 0% GPU utilization). The direct
  implementation runs the same real mechanics (real local SGD per client,
  real weighted parameter averaging, real held-out evaluation) with no
  process-spawning overhead: the full 8-round, 3-client run completes in
  about 19 seconds. Clients train against a real Dirichlet non-IID
  label-skew partition of PneumoniaMNIST (a real, publicly available chest
  X-ray dataset for binary pneumonia vs. normal classification — matching
  the chest-xray track's declared task); one verified run produced a
  genuinely improving loss curve (0.257 → 0.072 over 8 rounds) and a real
  held-out test AUROC of 0.921 on 624 images never seen during training.
  The model is a small custom CNN, not the DenseNet-121 named in the
  track's metadata — a known, documented gap driven by compute budget (one
  consumer GPU, not a cluster). Client count is 3, not the full 10, purely
  for iteration speed on this hardware — `dataset.NUM_CLIENTS` is the only
  thing to change to scale it back up. A `results.json` from a completed
  run is imported via `lib/db/src/import-training-run.ts` into the
  chest-xray track's Postgres rows (`network_overview`, `client_nodes`,
  for the 3 sites that actually trained) and a real `activity_events` row,
  replacing what used to be fixed arithmetic on a seed array index; the
  other 7 sites keep their original synthetic values and `totalSites`
  correctly stays 10.
  brain-mri and ct-lesion have no matching dataset wired up and remain
  fully synthetic — their FedAvg/FedProx/FedOpt labels, non-IID behavior,
  etc. are still descriptive text with no real training behind them. The
  same pipeline was also run, unmodified except for `DATASET_NAME`, against
  BreastMNIST (a second real MedMNIST binary-classification dataset) to
  demonstrate the FedAvg mechanics generalize beyond one dataset — this is
  still the chest-xray track's model and code, not a new track, and its
  output (`model-breastmnist.onnx`/`results-breastmnist.json`) is kept
  separate from the primary run's files.
- **Real per-round training metrics.** `training_rounds` (Postgres) stores
  each completed run's actual per-round loss/accuracy/sensitivity/
  specificity, imported by `import-training-run.ts` and served by
  `GET /network/training-rounds`; the training page's metric-trajectory
  chart plots this real data instead of a static illustration.
- **The agent's resolution outcome is now a real second model call.**
  `reviewOutcome()` in `agent.ts` makes a genuine, tool-grounded LLM call
  when a human approves or dismisses a recommendation — checking current
  telemetry (network overview, client nodes, recent events) before
  reporting what actually happened, replacing the template strings that
  used to fill `observedValue`/`outcome`. Verified live, twice, including
  automatic recovery from a transient Groq 429.
- **Real-time push.** `POST /network/inference`, agent assessment
  generation, and action resolution all broadcast over an authenticated
  WebSocket (`/api/ws`, same Clerk session check as the REST API) telling
  connected clients to refetch — not a duplicate data model over the wire,
  just a "something changed" signal. Verified live: unauthenticated
  upgrades get a real 401, authenticated ones receive a real broadcast
  payload.
- **Real per-hospital API keys for the one network boundary that exists
  today.** Each seeded hospital node has a real, randomly generated
  credential (shown once at issuance, only its SHA-256 hash stored —
  `lib/db/src/node-auth.ts`). `POST /network/inference` requires the
  matching key before it will attribute an upload to that node; missing or
  wrong keys get a real 403. This mitigates Sybil attacks at the inference
  endpoint specifically — it does not cover the training pipeline (which
  still runs as one simulated process, not a real multi-party protocol),
  and it's an API key, not mTLS/PKI. See "Single tenant, no real hospital
  identity" below for what's still missing.
- **Automated test suite.** `artifacts/api-server` has a Vitest suite
  (unit tests for softmax and the WebSocket auth/broadcast path, plus
  integration tests against a real Postgres instance for the inference,
  training-rounds, and node-API-key routes) and
  `ml/federation-engine/test_run.py` has pytest coverage for FedAvg
  averaging and Dirichlet partitioning correctness — run via
  `pnpm run test` and `pytest test_run.py` respectively.

## What's simulated, not yet production security

- **Real differential privacy (DP-SGD), no secure aggregation or
  encryption at the training-update level.** Local training now runs
  under real DP-SGD via Opacus (`ml/federation-engine/train_utils.py`'s
  `train_with_dp`): real per-example gradient clipping, real calibrated
  Gaussian noise, and a real epsilon computed by Opacus's RDP accountant —
  not a static display value. One PrivacyEngine per client persists across
  all 8 rounds so the reported epsilon reflects total privacy spent over
  the whole run; the network-level privacy budget is the maximum (weakest)
  per-client epsilon. Verified live: a real run at noise_multiplier=0.5,
  max_grad_norm=5.0 produced ε≈29 (δ=1e-5) after 8 rounds, with a measured
  accuracy cost (0.740 test AUROC vs. 0.921 without DP) — a real, reported
  tradeoff, not tuned to look better than it is. Secure aggregation and
  homomorphic encryption/MPC remain unimplemented; the privacy page now
  says "Secure aggregation: Not implemented" directly instead of a fake
  "Required" policy flag. See the Knowledge Center's "Privacy & security"
  module for the full concept-by-concept breakdown.
- **The model provider is a free-tier inference host, not a production
  commitment.** Groq's free tier is being used for development. Before real
  use, evaluate rate limits, uptime SLA, and data-handling terms for
  whatever provider is chosen — free-tier terms are not the same contract
  as a paid production agreement.
- **Real federated training exists, but only for 3 of 10 sites on one
  track.** The chest-xray track's overview and 3 of its 10 client-node
  rows now come from a completed real FedAvg run over real PneumoniaMNIST
  data (see "What's real today"); the other 7 chest-xray sites, and all of
  brain-mri and ct-lesion, still have no matching dataset or training
  behind them — their node metrics remain arithmetic on a seed array
  index, and FedProx/FedOpt are still just labels. Neither track uses
  MONAI, and the chest-xray model is a small custom CNN, not the
  DenseNet-121 named in the track metadata — a compute-budget tradeoff,
  not an oversight. The FedAvg implementation is also direct PyTorch, not
  Flower — Flower/Ray's simulation overhead proved unworkable on this
  hardware/OS combination and was dropped in favor of a plain training
  loop that does the same real computation faster and more reliably.
- **Single tenant, no real hospital identity beyond one API key per
  site.** The 10 "hospital nodes" are static seed data, and each does now
  have a real, hash-verified API key gating the inference endpoint (see
  "What's real today") — but there's no certificate-based identity, no
  mTLS, no enrollment/revocation workflow, and the training pipeline
  itself has no client-server protocol at all (it's one simulated
  process). Per-site attestation and mTLS between a real hospital client
  and the coordinator remain documented, not implemented.
- **No independent security review.** Nothing here has had a third-party
  penetration test, dependency audit beyond pnpm's supply-chain policy
  checks, or formal threat-model review.
- **No compliance work done.** No HIPAA, SOC 2, or equivalent assessment
  has been performed. This platform does not currently handle real patient
  data anywhere, by design — that boundary should hold until a compliance
  review has actually happened, not be treated as already satisfied.

## Before this could hold real hospital data

In roughly the order it would need to happen:

1. ~~Design and implement the actual Postgres schema, wire the API to it,
   and remove the in-memory state.~~ Done.
2. ~~A real AI agent — an actual LLM call with tool use over the now-real
   data, replacing the hardcoded recommendation/evidence strings.~~ Done and
   verified live for both assessment generation and the resolution-outcome
   call (`reviewOutcome()`).
3. ~~A real federated training engine (a real dataset, actual training
   rounds) to give the agent and the metrics something genuine to reason
   about.~~ Done for 3 of the chest-xray track's 10 sites: a direct
   PyTorch FedAvg implementation (Flower/Ray was tried and dropped —
   its simulation overhead was unworkable on this Windows/Docker/GPU
   setup) trains 3 simulated hospital clients over 8 rounds on real
   PneumoniaMNIST data with a real Dirichlet non-IID partition,
   GPU-accelerated, in about 19 seconds end to end, using a small custom
   CNN rather than the DenseNet-121 named in the track metadata
   (compute-budget tradeoff). The other 7 chest-xray sites, and all of
   brain-mri and ct-lesion, have no matching dataset and remain fully
   synthetic — extending real training to more clients or those tracks,
   or upgrading the model architecture, is still open. The same pipeline
   was validated against a second real dataset (BreastMNIST) to prove
   FedAvg generalizes, without claiming a new track.
4. Independent security review of the auth flow, Key Vault access model,
   and network isolation once real Container Apps are running.
5. ~~A real privacy-preserving mechanism (differential privacy and/or
   secure aggregation).~~ Partially done: real DP-SGD (Opacus) is live in
   local training with a genuine, computed epsilon (see "What's real
   today") — but it has not been independently reviewed, and per the
   product spec this cryptography-adjacent work should not be presented as
   production-enabled until it has. Secure aggregation remains
   unimplemented.
6. ~~Per-site identity and connectivity model for real hospital
   clients~~ — partially done: `POST /network/inference` now requires a
   real, hash-verified per-node API key (see "What's real today"). Still
   open: certificate-based identity, mTLS, key rotation, enrollment/
   revocation, and a real client-server protocol for the training pipeline
   itself
   (see `infra/azure/README.md`'s "manual steps" and the Knowledge Center's
   "Hospital-site connectivity" and "Sybil attacks" entries).
7. A named data-processing agreement / legal basis before any real
   patient-derived data — even de-identified — touches the system.

Until all of the above is true, every metric, privacy indicator, and agent
recommendation in this product remains research/demo telemetry, exactly as
the in-app disclaimers on every page already state.
