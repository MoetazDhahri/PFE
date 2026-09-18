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
- **Real federated training, for the chest-xray track only.** A PyTorch +
  Flower job at `ml/federation-engine/` runs 10 simulated hospital clients
  against a real Dirichlet non-IID label-skew partition of PneumoniaMNIST
  (a real, publicly available chest X-ray dataset for binary pneumonia vs.
  normal classification — matching the chest-xray track's declared task),
  with real local SGD training per client and real FedAvg weight
  aggregation across 8 rounds, GPU-accelerated. The model is a small custom
  CNN, not the DenseNet-121 named in the track's metadata — a known,
  documented gap driven by compute budget (one consumer GPU, not a
  cluster). A `results.json` from a completed run is imported via
  `lib/db/src/import-training-run.ts` into the chest-xray track's Postgres
  rows (`network_overview`, `client_nodes`) and a real `activity_events`
  row, replacing what used to be fixed arithmetic on a seed array index.
  brain-mri and ct-lesion have no matching dataset wired up and remain
  fully synthetic — their FedAvg/FedProx/FedOpt labels, non-IID behavior,
  etc. are still descriptive text with no real training behind them.

## What's simulated, not yet production security

- **No real differential privacy, secure aggregation, or encryption at
  the training-update level.** The privacy budget, noise mechanism, and
  secure-aggregation status shown in the dashboard are static display
  values, not the output of a real privacy accountant. See the Knowledge
  Center's "Privacy & security" module for the full concept-by-concept
  breakdown of what's implemented vs. reserved.
- **The agent's initial assessment is now real, its resolution outcome is not.**
  `POST /network/agent/assessments` makes a real tool-use call over live
  data to produce headline/summary/purpose/recommendation/evidence/confidence/impact/risk.
  But `observedValueFor()`/`outcomeFor()` in `federation.ts` — what gets
  recorded when a human resolves the card — are still template strings, not
  a second model call, because there's no real subsequent training round to
  actually observe an outcome from yet.
- **The model provider is a free-tier inference host, not a production
  commitment.** Groq's free tier is being used for development. Before real
  use, evaluate rate limits, uptime SLA, and data-handling terms for
  whatever provider is chosen — free-tier terms are not the same contract
  as a paid production agreement.
- **Real federated training exists, but only for one track.** The
  chest-xray track's node metrics now come from a completed PyTorch +
  Flower FedAvg run over real PneumoniaMNIST data (see "What's real
  today"). brain-mri and ct-lesion still have no matching dataset wired up:
  their node metrics remain arithmetic on a seed array index, and their
  named aggregation strategies (FedProx, FedOpt) are still just labels with
  no training loop behind them. Neither track uses MONAI, and the
  chest-xray model is a small custom CNN, not the DenseNet-121 named in
  the track metadata — a compute-budget tradeoff, not an oversight.
- **Single tenant, no real hospital identity.** The 10 "hospital nodes"
  are static seed data, not independently authenticated client services.
  Sybil resistance, per-site attestation, and mTLS between a real hospital
  client and the coordinator are documented, not implemented.
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
   verified live for assessment generation; the resolution-outcome text is
   still templated (see above).
3. ~~A real federated training engine (PyTorch/Flower, a real dataset,
   actual training rounds) to give the agent and the metrics something
   genuine to reason about.~~ Done for the chest-xray track only: a real
   PyTorch + Flower FedAvg job trains 10 simulated hospital clients over 8
   rounds on real PneumoniaMNIST data with a real Dirichlet non-IID
   partition, GPU-accelerated, using a small custom CNN rather than the
   DenseNet-121 named in the track metadata (compute-budget tradeoff).
   brain-mri and ct-lesion have no matching dataset and remain fully
   synthetic — extending real training to those tracks, or upgrading the
   chest-xray model architecture, is still open.
4. Independent security review of the auth flow, Key Vault access model,
   and network isolation once real Container Apps are running.
5. A real privacy-preserving aggregation implementation (secure
   aggregation and/or differential privacy) that has itself been reviewed —
   per the product spec, cryptography here should not be presented as
   production-enabled until independently validated.
6. Per-site identity and connectivity model for real hospital clients
   (see `infra/azure/README.md`'s "manual steps" and the Knowledge Center's
   "Hospital-site connectivity" and "Sybil attacks" entries).
7. A named data-processing agreement / legal basis before any real
   patient-derived data — even de-identified — touches the system.

Until all of the above is true, every metric, privacy indicator, and agent
recommendation in this product remains research/demo telemetry, exactly as
the in-app disclaimers on every page already state.
