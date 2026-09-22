"""Real federated learning run: simulated hospital clients (see
dataset.NUM_CLIENTS), real local SGD per client, real FedAvg weight
averaging, real held-out evaluation — PyTorch, GPU-accelerated when
available. Produces output/results.json consumed by
lib/db/src/import-training-run.ts to replace this repo's seeded chest-xray
numbers with genuinely trained ones.

This is a direct, single-process FedAvg implementation rather than
Flower/Ray-based simulation. Flower was tried first and does work
correctly, but its Ray-based actor model repeatedly caused severe
process-spawning and object-store overhead on this Windows/Docker/GPU-
passthrough setup (memory ballooning to 2GB+, hundreds of PIDs, multi-
minute single rounds) that a direct implementation does not have any
reason to hit at this scale (a handful of simulated clients in one
process). The federated-learning mechanics are identical either way —
local training per client, weighted parameter averaging, round-by-round
evaluation — this only changes which piece of software runs the loop.

DATASET_NAME (env var, default "pneumoniamnist") lets this same pipeline
run against a different real MedMNIST binary-classification dataset
(e.g. "breastmnist") to prove FedAvg generalizes beyond one dataset. This
does NOT create a new learning track — it's still the chest-xray track's
model and code, just pointed at a second real dataset for validation. See
ml/federation-engine/README.md.

Each client trains under real DP-SGD (Opacus): per-example gradient
clipping plus calibrated Gaussian noise, with a genuine (epsilon, delta)
privacy guarantee computed by Opacus's RDP accountant — not a display
placeholder. One PrivacyEngine per client persists across all
NUM_ROUNDS rounds so the reported epsilon reflects total privacy spent
over the whole run, not just the last round (see train_utils.train_with_dp
for why that distinction matters). This is real local DP-SGD applied
per-client, not a formal centrally-coordinated DP guarantee across the
federation as a whole — the network-level privacy budget reported to
Postgres is the maximum (weakest) per-client epsilon, since a federation's
guarantee is only as strong as its least private participant.

Resilience: each client's per-round local training runs in its own thread
with a bounded wait (CLIENT_TIMEOUT_SECONDS). A client that raises (a real
crash — bad data, OOM, whatever) or doesn't finish inside the timeout (a
real straggler) is dropped for that round only; FedAvg aggregates over
whichever clients actually responded, weighted by their sample counts —
`fedavg()` was already agnostic to how many clients it's given. The
dropped client rejoins next round from the current global parameters, the
same way a real asynchronous-ish federation would resync a client that
comes back online. SIMULATE_CLIENT_FAILURE (env var) deterministically
triggers this for a demo/report screenshot; the bounded-wait/drop/
partial-aggregate mechanism itself is real and would catch a genuine
crash or slow client with no flag set. Known limitation: Python threads
can't be forcibly killed, so a timed-out client's thread keeps running in
the background and its (discarded) result is simply never collected —
acceptable at this scale, not something a production system would do.

Performance comparison (pruning/quantization): when ENABLE_OPTIMIZATION_
COMPARISON is set, a second independent training run trains the same
NUM_ROUNDS on a structurally smaller CNN (PRUNE_WIDTH_REDUCTION fewer conv
channels — see model.ChestXraySmallCNN) so its wall-clock time is a real,
apples-to-apples "training time with vs without pruning" measurement
(shrinking the actual tensors is the only pruning approach that reduces
dense-hardware FLOPs; see optimize.py's docstring for why plain magnitude
pruning does not). Magnitude pruning (optimize.apply_magnitude_pruning)
and ONNX Runtime dynamic quantization (optimize.quantize_onnx_model) are
then applied on top for the communication-payload-size and inference-
latency/model-size comparisons those techniques actually earn.
"""

import json
import os
import threading
import time
from pathlib import Path

import numpy as np
import torch
from opacus import PrivacyEngine
from sklearn.metrics import average_precision_score, roc_auc_score

from dataset import CLIENT_TIERS, DIRICHLET_ALPHA, NUM_CLIENTS, load_client_partitions
from model import ChestXraySmallCNN
from train_utils import get_parameters, set_parameters, test, train_with_dp

NUM_ROUNDS = 8
LOCAL_EPOCHS = 1
DATASET_NAME = os.environ.get("DATASET_NAME", "pneumoniamnist")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# DP-SGD parameters (Opacus). These are real, measured tradeoffs, not
# hand-picked to make the demo look good: stronger noise/tighter clipping
# gives a smaller (better) epsilon at the cost of model accuracy, and this
# run reports whatever that tradeoff actually produces.
DP_NOISE_MULTIPLIER = float(os.environ.get("DP_NOISE_MULTIPLIER", "0.5"))
DP_MAX_GRAD_NORM = float(os.environ.get("DP_MAX_GRAD_NORM", "5.0"))
DP_DELTA = float(os.environ.get("DP_DELTA", "1e-5"))

# --- Resilience (validation point 3) ---------------------------------------
# How long the server waits for one client's local round before treating it
# as a straggler and moving on without it.
CLIENT_TIMEOUT_SECONDS = float(os.environ.get("CLIENT_TIMEOUT_SECONDS", "45"))
# Deterministic failure injection for demos/reports — off by default, so a
# plain run behaves exactly as before (every client participates).
SIMULATE_CLIENT_FAILURE = os.environ.get("SIMULATE_CLIENT_FAILURE", "").strip().lower() in ("1", "true", "yes")
SIMULATE_FAILURE_TIER = os.environ.get("SIMULATE_FAILURE_TIER", "low")
SIMULATE_FAILURE_ROUND = int(os.environ.get("SIMULATE_FAILURE_ROUND", "3"))
SIMULATE_FAILURE_MODE = os.environ.get("SIMULATE_FAILURE_MODE", "crash")  # "crash" or "slow"

# --- Performance comparison: pruning/quantization (validation point 2) -----
ENABLE_OPTIMIZATION_COMPARISON = os.environ.get("ENABLE_OPTIMIZATION_COMPARISON", "").strip().lower() in (
    "1", "true", "yes",
)
PRUNE_WIDTH_REDUCTION = float(os.environ.get("PRUNE_WIDTH_REDUCTION", "0.5"))  # structural (conv channel) pruning
PRUNE_MAGNITUDE_AMOUNT = float(os.environ.get("PRUNE_MAGNITUDE_AMOUNT", "0.3"))  # weight-level, for payload size
ENABLE_QUANTIZATION = os.environ.get("ENABLE_QUANTIZATION", "").strip().lower() in ("1", "true", "yes")


def fedavg(parameter_list: list[list[np.ndarray]], weights: list[int]) -> list[np.ndarray]:
    total = float(sum(weights))
    averaged: list[np.ndarray] = []
    for layer_idx in range(len(parameter_list[0])):
        layers = [params[layer_idx] * (w / total) for params, w in zip(parameter_list, weights)]
        averaged.append(np.sum(layers, axis=0))
    return averaged


def compute_global_test_metrics(parameters: list[np.ndarray], test_loader, model_ctor=ChestXraySmallCNN) -> dict:
    model = model_ctor()
    set_parameters(model, parameters)
    model.to(DEVICE)
    model.eval()

    all_probs, all_labels = [], []
    with torch.no_grad():
        for images, labels in test_loader:
            images = images.to(DEVICE)
            logits = model(images)
            probs = torch.softmax(logits, dim=1)[:, 1].cpu().numpy()
            all_probs.extend(probs.tolist())
            all_labels.extend(labels.numpy().tolist())

    all_probs = np.array(all_probs)
    all_labels = np.array(all_labels)
    predicted = (all_probs >= 0.5).astype(int)
    accuracy = float((predicted == all_labels).mean())
    auroc = float(roc_auc_score(all_labels, all_probs))
    auprc = float(average_precision_score(all_labels, all_probs))
    return {"accuracy": accuracy, "auroc": auroc, "auprc": auprc, "test_samples": int(len(all_labels))}


def _simulated_failure_mode(cid, round_num, tiers, enabled, target_tier, failure_round, mode):
    """Pure decision function (no env/globals) so it's unit-testable in
    isolation: should client `cid` fail this round, and how?
    """
    if not enabled or round_num != failure_round or tiers[cid] != target_tier:
        return None
    return mode


def _run_client_local_round(cid, model_ctor, global_params, train_loader, val_loader, privacy_engine, round_num, holder, simulate_failures):
    try:
        mode = _simulated_failure_mode(
            cid, round_num, CLIENT_TIERS,
            simulate_failures and SIMULATE_CLIENT_FAILURE,
            SIMULATE_FAILURE_TIER, SIMULATE_FAILURE_ROUND, SIMULATE_FAILURE_MODE,
        )
        if mode == "crash":
            raise RuntimeError(f"simulated crash on client {cid} ({CLIENT_TIERS[cid]} tier)")
        if mode == "slow":
            time.sleep(CLIENT_TIMEOUT_SECONDS + 5)

        local_model = model_ctor()
        set_parameters(local_model, global_params)
        epsilon = train_with_dp(
            local_model, train_loader, LOCAL_EPOCHS, DEVICE, privacy_engine,
            DP_NOISE_MULTIPLIER, DP_MAX_GRAD_NORM, DP_DELTA,
        )
        loss, accuracy, sensitivity, specificity = test(local_model, val_loader, DEVICE)
        holder["result"] = {
            "params": get_parameters(local_model),
            "n_train": len(train_loader.dataset),
            "eval": {
                "partition_id": cid,
                "tier": CLIENT_TIERS[cid],
                "num_examples": len(val_loader.dataset),
                "loss": loss,
                "accuracy": accuracy,
                "sensitivity": sensitivity,
                "specificity": specificity,
                "epsilon": epsilon,
            },
        }
    except Exception as exc:  # noqa: BLE001 - deliberately broad: any client-side failure must not kill the server
        holder["error"] = f"{type(exc).__name__}: {exc}"


def _train_rounds(model_ctor, global_params, train_loaders, val_loaders, client_privacy_engines, num_rounds, simulate_failures=False):
    """Runs `num_rounds` of FedAvg starting from `global_params`, building
    each round's local models via `model_ctor()` — the same loop backs
    both the baseline run and the structurally-pruned comparison run
    below; only the architecture `model_ctor` returns differs. Returns
    (final_params, round_history, wall_clock_seconds, last_round_eval_records)
    — the last item is whichever clients actually participated in the
    final round (a dropped client just isn't in it; see the resilience
    section of this module's docstring).
    """
    round_history: list[dict] = []
    last_round_eval_records: list[dict] = []
    started_at = time.time()

    for round_num in range(1, num_rounds + 1):
        client_params: list[list[np.ndarray]] = []
        client_weights: list[int] = []
        eval_records: list[dict] = []
        dropped_clients: list[dict] = []

        for cid in range(NUM_CLIENTS):
            holder: dict = {}
            thread = threading.Thread(
                target=_run_client_local_round,
                args=(
                    cid, model_ctor, global_params, train_loaders[cid], val_loaders[cid],
                    client_privacy_engines[cid], round_num, holder, simulate_failures,
                ),
                daemon=True,
            )
            thread.start()
            thread.join(timeout=CLIENT_TIMEOUT_SECONDS)

            if thread.is_alive():
                reason = f"exceeded {CLIENT_TIMEOUT_SECONDS:.0f}s timeout (straggler)"
            elif "error" in holder:
                reason = holder["error"]
            else:
                reason = None

            if reason is not None:
                dropped_clients.append({"partition_id": cid, "tier": CLIENT_TIERS[cid], "reason": reason})
                print(f"[ROUND {round_num}] client {cid} ({CLIENT_TIERS[cid]} tier) DROPPED: {reason}", flush=True)
                continue

            result = holder["result"]
            client_params.append(result["params"])
            client_weights.append(result["n_train"])
            eval_records.append(result["eval"])

        if not client_params:
            raise RuntimeError(f"Round {round_num}: every client failed or timed out — cannot aggregate.")

        global_params = fedavg(client_params, client_weights)

        total_n = sum(r["num_examples"] for r in eval_records)
        global_accuracy = sum(r["accuracy"] * r["num_examples"] for r in eval_records) / total_n
        global_loss = sum(r["loss"] * r["num_examples"] for r in eval_records) / total_n
        global_sensitivity = sum(r["sensitivity"] * r["num_examples"] for r in eval_records) / total_n
        global_specificity = sum(r["specificity"] * r["num_examples"] for r in eval_records) / total_n
        # Weakest (largest) per-client epsilon so far — a federation's real
        # privacy guarantee is only as strong as its least private
        # participant. Strictly non-decreasing round over round, which is
        # the real, observable signature of correct privacy composition.
        max_epsilon = max(r["epsilon"] for r in eval_records)

        round_history.append({
            "round": round_num,
            "global_loss": global_loss,
            "global_accuracy": global_accuracy,
            "global_sensitivity": global_sensitivity,
            "global_specificity": global_specificity,
            "privacy_epsilon": max_epsilon,
            "participating_clients": [r["partition_id"] for r in eval_records],
            "dropped_clients": dropped_clients,
        })
        print(
            f"[ROUND {round_num}] global_accuracy={global_accuracy:.4f} "
            f"global_loss={global_loss:.4f} max_epsilon={max_epsilon:.3f} "
            f"clients={len(eval_records)}/{NUM_CLIENTS}",
            flush=True,
        )
        last_round_eval_records = eval_records

    duration = time.time() - started_at
    return global_params, round_history, duration, last_round_eval_records


def _export_onnx(model_ctor, parameters, path):
    model = model_ctor()
    set_parameters(model, parameters)
    model.eval()
    dummy_input = torch.zeros(1, 1, 28, 28)
    torch.onnx.export(
        model, dummy_input, path,
        input_names=["image"], output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
    )
    return path


def _run_optimization_comparison(train_loaders, val_loaders, test_loader, model_path, suffix):
    """Trains a second, independent federation run on a structurally
    smaller CNN for the same NUM_ROUNDS, so its `duration_seconds` is a
    real, controlled "training time without vs with pruning" comparison
    against the baseline run already captured in `main()`. Then applies
    magnitude pruning (payload size) and, optionally, ONNX Runtime
    quantization (model size / inference latency) on top. See run.py's and
    optimize.py's module docstrings for why each technique is scoped to
    what it actually measures.
    """
    from optimize import apply_magnitude_pruning, measure_onnx_model, payload_size_bytes, quantize_onnx_model

    reduced_c1 = max(1, round(16 * (1 - PRUNE_WIDTH_REDUCTION)))
    reduced_c2 = max(1, round(32 * (1 - PRUNE_WIDTH_REDUCTION)))
    pruned_ctor = lambda: ChestXraySmallCNN(c1=reduced_c1, c2=reduced_c2)  # noqa: E731

    pruned_model = pruned_ctor()
    pruned_init_params = get_parameters(pruned_model)
    pruned_privacy_engines = [PrivacyEngine() for _ in range(NUM_CLIENTS)]

    print(
        f"[OPTIMIZATION] training comparison model (conv channels {reduced_c1}/{reduced_c2}, "
        f"{int(PRUNE_WIDTH_REDUCTION * 100)}% narrower) for {NUM_ROUNDS} rounds...",
        flush=True,
    )
    pruned_final_params, pruned_round_history, pruned_duration, _ = _train_rounds(
        pruned_ctor, pruned_init_params, train_loaders, val_loaders, pruned_privacy_engines,
        NUM_ROUNDS, simulate_failures=False,
    )
    pruned_test_metrics = compute_global_test_metrics(pruned_final_params, test_loader, model_ctor=pruned_ctor)

    magnitude_pruned_model = pruned_ctor()
    set_parameters(magnitude_pruned_model, pruned_final_params)
    achieved_sparsity = apply_magnitude_pruning(magnitude_pruned_model, PRUNE_MAGNITUDE_AMOUNT)
    magnitude_pruned_params = get_parameters(magnitude_pruned_model)

    pruned_model_path = f"/app/output/model{suffix}-pruned.onnx"
    _export_onnx(pruned_ctor, magnitude_pruned_params, pruned_model_path)

    result = {
        "structural_pruning": {
            "conv_channels": {"baseline": [16, 32], "pruned": [reduced_c1, reduced_c2]},
            "width_reduction": PRUNE_WIDTH_REDUCTION,
            "num_rounds": NUM_ROUNDS,
            "duration_seconds": round(pruned_duration, 2),
            "avg_seconds_per_round": round(pruned_duration / NUM_ROUNDS, 3),
            "round_history": pruned_round_history,
            "test_metrics": pruned_test_metrics,
        },
        "magnitude_pruning": {
            "amount": PRUNE_MAGNITUDE_AMOUNT,
            "achieved_sparsity": achieved_sparsity,
            "payload_bytes_before": payload_size_bytes(pruned_final_params),
            "payload_bytes_after": payload_size_bytes(magnitude_pruned_params),
        },
        "baseline_model_metrics": measure_onnx_model(model_path, test_loader),
        "pruned_model_metrics": measure_onnx_model(pruned_model_path, test_loader),
        "pruned_model_path": pruned_model_path,
        "quantization_enabled": ENABLE_QUANTIZATION,
    }

    if ENABLE_QUANTIZATION:
        quantized_model_path = f"/app/output/model{suffix}-pruned-int8.onnx"
        quantize_onnx_model(pruned_model_path, quantized_model_path)
        result["quantized_model_metrics"] = measure_onnx_model(quantized_model_path, test_loader)
        result["quantized_model_path"] = quantized_model_path
        fp32_size = result["pruned_model_metrics"]["file_size_bytes"]
        int8_size = result["quantized_model_metrics"]["file_size_bytes"]
        result["quantization_size_reduction_x"] = round(fp32_size / int8_size, 2) if int8_size else None

    return result


def main():
    print(f"Using device: {DEVICE}, dataset: {DATASET_NAME}", flush=True)
    train_loaders, val_loaders, test_loader, client_label_counts = load_client_partitions(DATASET_NAME)

    global_model = ChestXraySmallCNN()
    global_params = get_parameters(global_model)

    # One PrivacyEngine per client, created once and reused every round —
    # its accountant accumulates privacy loss across the whole run (see
    # module docstring and train_with_dp).
    client_privacy_engines = [PrivacyEngine() for _ in range(NUM_CLIENTS)]

    global_params, round_history, duration, final_client_results = _train_rounds(
        ChestXraySmallCNN, global_params, train_loaders, val_loaders, client_privacy_engines,
        NUM_ROUNDS, simulate_failures=True,
    )

    global_test_metrics = compute_global_test_metrics(global_params, test_loader)

    # The primary dataset's results/model keep their original filenames
    # (consumed by lib/db/src/import-training-run.ts). A non-default
    # dataset run gets a suffixed filename so it never clobbers those —
    # it's a validation run, not a replacement for the chest-xray track's
    # trained model.
    is_primary_dataset = DATASET_NAME == "pneumoniamnist"
    suffix = "" if is_primary_dataset else f"-{DATASET_NAME}"

    Path("/app/output").mkdir(parents=True, exist_ok=True)
    model_path = f"/app/output/model{suffix}.onnx"
    _export_onnx(ChestXraySmallCNN, global_params, model_path)
    print(f"Wrote {model_path}", flush=True)

    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration_seconds": round(duration, 1),
        "device": str(DEVICE),
        "dataset_name": DATASET_NAME,
        "num_clients": NUM_CLIENTS,
        "num_rounds": NUM_ROUNDS,
        "dirichlet_alpha": DIRICHLET_ALPHA,
        "client_label_counts": client_label_counts,
        "client_tiers": CLIENT_TIERS,
        "round_history": round_history,
        "final_client_results": final_client_results,
        "global_test_metrics": global_test_metrics,
        "differential_privacy": {
            "mechanism": "DP-SGD (Opacus): per-example gradient clipping + Gaussian noise",
            "noise_multiplier": DP_NOISE_MULTIPLIER,
            "max_grad_norm": DP_MAX_GRAD_NORM,
            "delta": DP_DELTA,
            "final_privacy_epsilon": round_history[-1]["privacy_epsilon"] if round_history else None,
        },
        "resilience": {
            "client_timeout_seconds": CLIENT_TIMEOUT_SECONDS,
            "simulate_client_failure": SIMULATE_CLIENT_FAILURE,
            "simulate_failure_tier": SIMULATE_FAILURE_TIER if SIMULATE_CLIENT_FAILURE else None,
            "simulate_failure_round": SIMULATE_FAILURE_ROUND if SIMULATE_CLIENT_FAILURE else None,
            "simulate_failure_mode": SIMULATE_FAILURE_MODE if SIMULATE_CLIENT_FAILURE else None,
            "rounds_with_dropped_clients": [
                {"round": r["round"], "dropped_clients": r["dropped_clients"]}
                for r in round_history if r["dropped_clients"]
            ],
        },
    }

    if ENABLE_OPTIMIZATION_COMPARISON:
        output["optimization"] = _run_optimization_comparison(train_loaders, val_loaders, test_loader, model_path, suffix)

    results_path = f"/app/output/results{suffix}.json"
    with open(results_path, "w") as f:
        json.dump(output, f, indent=2)

    print(json.dumps(output["round_history"], indent=2))
    print(f"Wrote {results_path} in {duration:.1f}s")


if __name__ == "__main__":
    main()
