# Federation training engine

A real (not simulated) federated learning training run for the `chest-xray`
learning track: direct PyTorch FedAvg over a real, non-IID-partitioned
medical imaging dataset. Standalone Python service — **not** part of the
pnpm workspace, not typechecked or built by CI, not imported by anything
in `artifacts/`. It produces a results file that a separate TypeScript
script imports into Postgres; see [Wiring into the app](#wiring-into-the-app).

## Why this isn't Flower

The original plan (and this repo's Knowledge Center still documents this
as the target architecture) was Flower + Ray for the federated simulation
layer. It was implemented, and it does work — but on this project's
actual development environment (Windows, Docker Desktop, GPU passthrough)
it was unusable in practice:

- Ray's actor model spawned hundreds of worker processes for as few as 3
  logical clients, ballooning container memory past 2GB and causing
  Docker Desktop itself to degrade (500 errors, hung commands) under the
  load.
- A single round took multiple minutes with **0% GPU utilization** —
  training was silently happening on CPU inside the Ray workers despite
  the driver process correctly detecting CUDA.
- The fix that should have worked (lazy per-client data loading instead of
  eager loading in every worker) reduced but did not eliminate the
  problem — Ray re-spawned fresh worker processes per task rather than
  reusing them, so the per-process cache didn't help.

None of this is a knock on Flower generally — it's built for exactly this
problem at a much larger scale than "3 clients on one GPU," and the
overhead that's unaffordable here is the point of the framework at real
scale. For this repo's actual current need (a demo-scale training run,
iterated on quickly, on one consumer GPU), a direct implementation removes
the entire failure surface: `run.py`'s training loop is under 90 lines and
does the identical real computation — real local SGD per client, real
FedAvg weight averaging, real held-out evaluation — with no process
spawning, no object store, no serialization overhead. A verified run
completes 8 rounds across 3 clients in **19 seconds** on a GTX 1650.

If you need to scale this to genuinely many clients across real machines
later, revisit Flower then — that's the scale it's for. `flwr` has been
removed from `requirements.txt`; there's no leftover dependency to trip
over.

## What's real and what isn't

| Piece | Status |
|---|---|
| PneumoniaMNIST dataset | Real — a real, public chest X-ray dataset (binary pneumonia/normal), auto-downloaded via the `medmnist` package |
| Dirichlet non-IID partition | Real — clients get genuinely different label distributions, not an identical i.i.d. slice |
| Local training per client | Real DP-SGD (Opacus) — per-example gradient clipping + calibrated Gaussian noise, not plain SGD (see "Differential privacy" below) |
| FedAvg aggregation | Real — actual weighted average of client state_dicts, weighted by sample count |
| Held-out test evaluation | Real — AUROC/AUPRC/accuracy on a test split never seen during training |
| Differential privacy | Real — a genuine (ε, δ)-DP guarantee computed by Opacus's RDP accountant, not a display placeholder. One `PrivacyEngine` per client persists across all rounds so epsilon reflects total privacy spent, not just the last round |
| Model architecture | A small custom CNN (`model.py`), **not** the DenseNet-121 named in the product's track metadata — a compute-budget tradeoff, stated explicitly here so nobody mistakes one for the other |
| Client count | 3 (`dataset.NUM_CLIENTS`), not the full 10 the product simulates — purely for iteration speed on one GPU |
| Scope | `chest-xray` track only. `brain-mri`/`ct-lesion` have no matching real dataset wired up here. The same pipeline has also been validated against BreastMNIST (`DATASET_NAME=breastmnist`) to prove FedAvg generalizes — still the chest-xray track's model/code, not a new track |
| Continuous operation | Not implemented. This is a one-shot batch job you run manually and import once — no scheduler, no live progress in the UI, no automatic re-run |

## Differential privacy

Every client trains under real DP-SGD (`train_utils.py`'s `train_with_dp`,
via [Opacus](https://opacus.ai)): per-example gradient clipping bounds any
single training example's influence, then calibrated Gaussian noise is
added before the optimizer step. `run.py` creates one `PrivacyEngine` per
client *before* the round loop and reuses the same instance every round —
its accountant composes privacy loss across the whole run, so the reported
epsilon is the real cumulative cost, not a single round's. The network-wide
privacy budget reported to Postgres is the maximum (weakest) per-client
epsilon, since a federation's real guarantee is only as strong as its
least private participant.

Tunable via env vars (`DP_NOISE_MULTIPLIER`, `DP_MAX_GRAD_NORM`,
`DP_DELTA`; defaults `0.5`/`5.0`/`1e-5`). These defaults were arrived at by
actually observing the tradeoff, not picked to look good: `max_grad_norm
=1.0` collapsed the model into always predicting the majority class
(specificity 0.0) regardless of noise level — the clip was suppressing
real signal, not just outliers. Loosening it to `5.0` let the model
recover to a real (if privacy-costly) result: ε≈29 (δ=1e-5) after 8
rounds, with a measured accuracy drop versus the non-DP baseline (0.740
vs. 0.921 test AUROC). This is local per-client DP-SGD, not a formal
centrally-coordinated DP guarantee across the federation as a whole.

## Running it

Requires Docker with GPU passthrough configured (`docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` should print your GPU). CPU-only also works, just slower — the model and dataset are tiny enough that it's still fast.

```bash
# From the repo root:
docker build -t fedimg-ml ml/federation-engine

mkdir -p ml/federation-engine/output ml/federation-engine/data
docker run --rm --gpus all \
  -v "$(pwd)/ml/federation-engine/output:/app/output" \
  -v "$(pwd)/ml/federation-engine/data:/app/data" \
  fedimg-ml
```

(Omit `--gpus all` to force CPU.) The `data` volume caches the downloaded
dataset across runs so you don't re-download it every time. Expect
console output per round:

```
[ROUND 1] global_accuracy=0.8006 global_loss=0.5132 max_epsilon=12.553
...
[ROUND 8] global_accuracy=0.8006 global_loss=0.5210 max_epsilon=29.063
Wrote /app/output/results.json in 69.1s
```

(Accuracy and epsilon shown are from one real DP-SGD run at the defaults
above — expect similar, not identical, numbers, since training is
stochastic.)

**If the bind-mounted `output/results.json` doesn't appear on the host**
(a real, unexplained flake seen once during development on this Windows
setup — the container logged a successful write but the host-side mount
didn't reflect it), retrieve it directly from the container instead:

```bash
docker ps -a   # find the container name/id (it exits after the run)
docker cp <container>:/app/output/results.json ml/federation-engine/output/results.json
```

## Wiring into the app

`results.json` isn't picked up automatically — import it explicitly:

```bash
cd lib/db
DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  pnpm run import-training-run ../../ml/federation-engine/output/results.json
```

See `lib/db/src/import-training-run.ts` for exactly what this touches:
`network_overview` for the `chest-xray` track, and the `client_nodes` rows
for whichever sites actually trained (`site-1`, `site-2`, ... in the same
order as `dataset.py`'s partition indices and `lib/db/src/seed.ts`'s site
list). It intentionally does **not** touch `totalSites` (stays at whatever
it already was — 10 — so the UI still shows "N of 10 connected" correctly)
and does not touch any site beyond `NUM_CLIENTS`, or any other track.

## Changing the scale

- **More/fewer clients**: change `NUM_CLIENTS` in `dataset.py`. Everything
  (partitioning, training, the results schema, the import script) reads
  from that constant — nothing else needs to change. Note the import
  script maps partition index `i` to `site-{i+1}`, so raising `NUM_CLIENTS`
  above 10 would need corresponding new seed sites first.
- **More rounds**: `NUM_ROUNDS` in `run.py`.
- **A different dataset / a real MRI or CT source for the other tracks**:
  swap out `dataset.py`'s `_load_raw()` and adjust `model.py`'s input
  shape accordingly; `run.py`'s FedAvg loop itself is dataset-agnostic.
- **A bigger model**: swap `model.py`'s `ChestXraySmallCNN`. Nothing else
  depends on its exact architecture, only its `forward()` producing 2
  logits for the binary classification.

## Files

| File | Purpose |
|---|---|
| `dataset.py` | Loads PneumoniaMNIST, Dirichlet-partitions it across clients, builds PyTorch `DataLoader`s |
| `model.py` | The CNN — 2 conv+pool layers, 2 FC layers, 28×28 grayscale in, 2-class out |
| `train_utils.py` | `get_parameters`/`set_parameters` (state_dict ↔ numpy round-trip for FedAvg), local `train_with_dp()` (real DP-SGD via Opacus), `test()` with accuracy/sensitivity/specificity |
| `run.py` | Entrypoint — the FedAvg loop, per-client `PrivacyEngine`s, held-out evaluation, `results.json` writer |
| `test_run.py` | pytest unit tests for `fedavg()` averaging and `_dirichlet_partition()` correctness — run via `pytest test_run.py -v` |
| `Dockerfile` | `pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime` base, installs `requirements.txt`, runs `run.py` |
| `requirements.txt` | `medmnist`, `numpy`, `scikit-learn`, `opacus`, `onnx`, `pytest` — no `flwr` |
