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
"""

import json
import os
import time
from pathlib import Path

import numpy as np
import torch
from opacus import PrivacyEngine
from sklearn.metrics import average_precision_score, roc_auc_score

from dataset import DIRICHLET_ALPHA, NUM_CLIENTS, load_client_partitions
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


def fedavg(parameter_list: list[list[np.ndarray]], weights: list[int]) -> list[np.ndarray]:
    total = float(sum(weights))
    averaged: list[np.ndarray] = []
    for layer_idx in range(len(parameter_list[0])):
        layers = [params[layer_idx] * (w / total) for params, w in zip(parameter_list, weights)]
        averaged.append(np.sum(layers, axis=0))
    return averaged


def compute_global_test_metrics(parameters: list[np.ndarray], test_loader) -> dict:
    model = ChestXraySmallCNN()
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


def main():
    print(f"Using device: {DEVICE}, dataset: {DATASET_NAME}", flush=True)
    train_loaders, val_loaders, test_loader, client_label_counts = load_client_partitions(DATASET_NAME)

    started_at = time.time()
    global_model = ChestXraySmallCNN()
    global_params = get_parameters(global_model)

    # One PrivacyEngine per client, created once and reused every round —
    # its accountant accumulates privacy loss across the whole run (see
    # module docstring and train_with_dp).
    client_privacy_engines = [PrivacyEngine() for _ in range(NUM_CLIENTS)]

    round_history: list[dict] = []
    final_client_results: list[dict] = []

    for round_num in range(1, NUM_ROUNDS + 1):
        client_params: list[list[np.ndarray]] = []
        client_weights: list[int] = []
        eval_records: list[dict] = []

        for cid in range(NUM_CLIENTS):
            local_model = ChestXraySmallCNN()
            set_parameters(local_model, global_params)
            epsilon = train_with_dp(
                local_model,
                train_loaders[cid],
                LOCAL_EPOCHS,
                DEVICE,
                client_privacy_engines[cid],
                DP_NOISE_MULTIPLIER,
                DP_MAX_GRAD_NORM,
                DP_DELTA,
            )

            n_train = len(train_loaders[cid].dataset)
            client_params.append(get_parameters(local_model))
            client_weights.append(n_train)

            loss, accuracy, sensitivity, specificity = test(local_model, val_loaders[cid], DEVICE)
            eval_records.append({
                "partition_id": cid,
                "num_examples": len(val_loaders[cid].dataset),
                "loss": loss,
                "accuracy": accuracy,
                "sensitivity": sensitivity,
                "specificity": specificity,
                "epsilon": epsilon,
            })

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
        })
        print(
            f"[ROUND {round_num}] global_accuracy={global_accuracy:.4f} "
            f"global_loss={global_loss:.4f} max_epsilon={max_epsilon:.3f}",
            flush=True,
        )

        if round_num == NUM_ROUNDS:
            final_client_results = eval_records

    duration = time.time() - started_at
    global_test_metrics = compute_global_test_metrics(global_params, test_loader)

    # The primary dataset's results/model keep their original filenames
    # (consumed by lib/db/src/import-training-run.ts). A non-default
    # dataset run gets a suffixed filename so it never clobbers those —
    # it's a validation run, not a replacement for the chest-xray track's
    # trained model.
    is_primary_dataset = DATASET_NAME == "pneumoniamnist"
    suffix = "" if is_primary_dataset else f"-{DATASET_NAME}"

    final_model = ChestXraySmallCNN()
    set_parameters(final_model, global_params)
    final_model.eval()
    Path("/app/output").mkdir(parents=True, exist_ok=True)
    dummy_input = torch.zeros(1, 1, 28, 28)
    model_path = f"/app/output/model{suffix}.onnx"
    torch.onnx.export(
        final_model,
        dummy_input,
        model_path,
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
    )
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
    }

    results_path = f"/app/output/results{suffix}.json"
    with open(results_path, "w") as f:
        json.dump(output, f, indent=2)

    print(json.dumps(output["round_history"], indent=2))
    print(f"Wrote {results_path} in {duration:.1f}s")


if __name__ == "__main__":
    main()
