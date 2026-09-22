"""Loads a real MedMNIST binary-classification dataset and partitions it
into NUM_CLIENTS non-IID shards, one per simulated hospital, matching the
first NUM_CLIENTS sites seeded into Postgres by lib/db/src/seed.ts
(site-1, site-2, ...).

Defaults to PneumoniaMNIST (chest X-rays, pneumonia vs. normal) — the
dataset this repo's chest-xray track is built on. run.py's DATASET_NAME
can point this at any other MedMNIST 2D binary-classification dataset
(e.g. breastmnist) to prove the same FedAvg pipeline generalizes to a
second real dataset; this reuses the chest-xray track's model and code
as-is rather than claiming to be a different learning track (that would
need a real MRI/CT dataset and a different model architecture — see
ml/federation-engine/README.md).
"""

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
import medmnist
from medmnist import INFO

NUM_CLIENTS = 3
DIRICHLET_ALPHA = 0.5  # lower = more non-IID (label-skewed) across clients

# Simulated hospital compute tier per client id — a real-world stand-in for
# e.g. a large hospital's GPU server ("high") vs a small clinic's laptop
# ("low"). Used by run.py to decide which client the resilience demo
# (SIMULATE_CLIENT_FAILURE) can knock out; cycles if NUM_CLIENTS > 3.
_TIER_CYCLE = ["high", "mid", "low"]
CLIENT_TIERS = [_TIER_CYCLE[i % len(_TIER_CYCLE)] for i in range(NUM_CLIENTS)]


class ArrayDataset(Dataset):
    def __init__(self, images: np.ndarray, labels: np.ndarray):
        # medmnist images are (N, 28, 28) uint8; normalize to [0, 1] and add channel dim.
        self.images = torch.tensor(images, dtype=torch.float32).unsqueeze(1) / 255.0
        self.labels = torch.tensor(labels, dtype=torch.long).squeeze(-1)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        return self.images[idx], self.labels[idx]


def _dirichlet_partition(labels: np.ndarray, num_clients: int, alpha: float, seed: int = 42):
    """Standard label-skew Dirichlet partition used in FL research: each
    client gets a different, randomly-skewed mix of classes rather than an
    identical i.i.d. slice, so this is genuinely non-IID data, not just a
    round-robin split.

    Retries with a new draw if any client ends up with too few samples —
    with alpha=0.5 and 10 clients, an unlucky draw can starve a client down
    to a handful of examples or zero, which crashes DataLoader/FedAvg
    rather than just producing a weak client."""
    min_samples_per_client = 30

    for attempt in range(50):
        rng = np.random.default_rng(seed + attempt)
        classes = np.unique(labels)
        client_indices = [[] for _ in range(num_clients)]

        for c in classes:
            class_idx = np.where(labels == c)[0]
            rng.shuffle(class_idx)
            proportions = rng.dirichlet(alpha=[alpha] * num_clients)
            split_points = (np.cumsum(proportions) * len(class_idx)).astype(int)[:-1]
            for client_id, shard in enumerate(np.split(class_idx, split_points)):
                client_indices[client_id].extend(shard.tolist())

        if min(len(idx) for idx in client_indices) >= min_samples_per_client:
            return client_indices

    raise RuntimeError(
        f"Could not find a Dirichlet partition (alpha={alpha}) giving every "
        f"client >= {min_samples_per_client} samples after 50 attempts."
    )


def _load_raw(dataset_name: str, image_size: int = 28):
    info = INFO[dataset_name]
    if info["task"] != "binary-class":
        raise ValueError(
            f'Dataset "{dataset_name}" is task "{info["task"]}", not "binary-class" — '
            "the model, loss, and sensitivity/specificity metrics here all assume two classes."
        )
    data_class = getattr(medmnist, info["python_class"])
    train_raw = data_class(split="train", download=True, size=image_size, root="/app/data")
    test_raw = data_class(split="test", download=True, size=image_size, root="/app/data")
    return train_raw.imgs, train_raw.labels, test_raw.imgs, test_raw.labels


def _train_val_split(indices: np.ndarray):
    indices = np.array(indices)
    rng = np.random.default_rng(0)
    rng.shuffle(indices)
    split = max(1, int(len(indices) * 0.85))
    train_idx = indices[:split]
    val_idx = indices[split:] if len(indices) > split else indices[:1]
    return train_idx, val_idx


def load_client_partitions(dataset_name: str = "pneumoniamnist", batch_size: int = 32, image_size: int = 28):
    """Builds every client's loaders plus the held-out test set."""
    train_images, train_labels, test_images, test_labels = _load_raw(dataset_name, image_size)
    client_indices = _dirichlet_partition(train_labels.squeeze(-1), NUM_CLIENTS, DIRICHLET_ALPHA)

    train_loaders = []
    val_loaders = []
    client_label_counts = []
    for indices in client_indices:
        train_idx, val_idx = _train_val_split(indices)
        train_ds = ArrayDataset(train_images[train_idx], train_labels[train_idx])
        val_ds = ArrayDataset(train_images[val_idx], train_labels[val_idx])
        train_loaders.append(DataLoader(train_ds, batch_size=batch_size, shuffle=True))
        val_loaders.append(DataLoader(val_ds, batch_size=batch_size, shuffle=False))

        labels_here = train_labels[train_idx].squeeze(-1)
        client_label_counts.append({
            "total": int(len(train_idx)),
            "class_0_normal": int(np.sum(labels_here == 0)),
            "class_1_pneumonia": int(np.sum(labels_here == 1)),
        })

    test_ds = ArrayDataset(test_images, test_labels)
    test_loader = DataLoader(test_ds, batch_size=128, shuffle=False)

    return train_loaders, val_loaders, test_loader, client_label_counts
