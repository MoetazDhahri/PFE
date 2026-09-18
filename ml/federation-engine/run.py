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
"""

import json
import time
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import average_precision_score, roc_auc_score

from dataset import DIRICHLET_ALPHA, NUM_CLIENTS, load_client_partitions
from model import ChestXraySmallCNN
from train_utils import get_parameters, set_parameters, test, train

NUM_ROUNDS = 8
LOCAL_EPOCHS = 1
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


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
    print(f"Using device: {DEVICE}", flush=True)
    train_loaders, val_loaders, test_loader, client_label_counts = load_client_partitions()

    started_at = time.time()
    global_model = ChestXraySmallCNN()
    global_params = get_parameters(global_model)

    round_history: list[dict] = []
    final_client_results: list[dict] = []

    for round_num in range(1, NUM_ROUNDS + 1):
        client_params: list[list[np.ndarray]] = []
        client_weights: list[int] = []
        eval_records: list[dict] = []

        for cid in range(NUM_CLIENTS):
            local_model = ChestXraySmallCNN()
            set_parameters(local_model, global_params)
            train(local_model, train_loaders[cid], LOCAL_EPOCHS, DEVICE)

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
            })

        global_params = fedavg(client_params, client_weights)

        total_n = sum(r["num_examples"] for r in eval_records)
        global_accuracy = sum(r["accuracy"] * r["num_examples"] for r in eval_records) / total_n
        global_loss = sum(r["loss"] * r["num_examples"] for r in eval_records) / total_n
        global_sensitivity = sum(r["sensitivity"] * r["num_examples"] for r in eval_records) / total_n
        global_specificity = sum(r["specificity"] * r["num_examples"] for r in eval_records) / total_n

        round_history.append({
            "round": round_num,
            "global_loss": global_loss,
            "global_accuracy": global_accuracy,
            "global_sensitivity": global_sensitivity,
            "global_specificity": global_specificity,
        })
        print(
            f"[ROUND {round_num}] global_accuracy={global_accuracy:.4f} "
            f"global_loss={global_loss:.4f}",
            flush=True,
        )

        if round_num == NUM_ROUNDS:
            final_client_results = eval_records

    duration = time.time() - started_at
    global_test_metrics = compute_global_test_metrics(global_params, test_loader)

    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration_seconds": round(duration, 1),
        "device": str(DEVICE),
        "num_clients": NUM_CLIENTS,
        "num_rounds": NUM_ROUNDS,
        "dirichlet_alpha": DIRICHLET_ALPHA,
        "client_label_counts": client_label_counts,
        "round_history": round_history,
        "final_client_results": final_client_results,
        "global_test_metrics": global_test_metrics,
    }

    Path("/app/output").mkdir(parents=True, exist_ok=True)
    with open("/app/output/results.json", "w") as f:
        json.dump(output, f, indent=2)

    print(json.dumps(output["round_history"], indent=2))
    print(f"Wrote /app/output/results.json in {duration:.1f}s")


if __name__ == "__main__":
    main()
