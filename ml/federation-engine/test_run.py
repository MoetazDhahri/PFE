"""Unit tests for the pure, non-training logic in run.py and dataset.py:
FedAvg weight averaging and the Dirichlet client partitioning. These don't
need a GPU, medmnist download, or a training loop to verify correctness.

Run inside the ml/federation-engine Docker image (see Dockerfile / README):
    docker build -t federation-engine .
    docker run --rm federation-engine pytest test_run.py -v
"""

import numpy as np
import pytest
import torch

from run import _simulated_failure_mode, fedavg
from dataset import _dirichlet_partition
from optimize import apply_magnitude_pruning, payload_size_bytes


def test_fedavg_equal_weights_averages():
    client_a = [np.array([2.0, 4.0]), np.array([[1.0, 1.0]])]
    client_b = [np.array([4.0, 8.0]), np.array([[3.0, 3.0]])]
    result = fedavg([client_a, client_b], weights=[1, 1])

    assert np.allclose(result[0], [3.0, 6.0])
    assert np.allclose(result[1], [[2.0, 2.0]])


def test_fedavg_weighted_by_sample_count():
    client_a = [np.array([0.0])]
    client_b = [np.array([10.0])]
    # Client B has 3x the samples, so it should dominate the average.
    result = fedavg([client_a, client_b], weights=[1, 3])

    assert np.allclose(result[0], [7.5])


def test_fedavg_single_client_is_identity():
    params = [np.array([1.0, 2.0, 3.0])]
    result = fedavg([params], weights=[42])

    assert np.allclose(result[0], params[0])


def test_fedavg_preserves_layer_shapes():
    client_a = [np.zeros((3, 3)), np.zeros(5)]
    client_b = [np.ones((3, 3)), np.ones(5)]
    result = fedavg([client_a, client_b], weights=[1, 1])

    assert result[0].shape == (3, 3)
    assert result[1].shape == (5,)
    assert np.allclose(result[0], 0.5)
    assert np.allclose(result[1], 0.5)


def test_dirichlet_partition_covers_every_sample_exactly_once():
    labels = np.array([0, 1] * 200)  # 400 samples, balanced
    indices = _dirichlet_partition(labels, num_clients=4, alpha=0.5)

    all_indices = sorted(i for shard in indices for i in shard)
    assert all_indices == list(range(len(labels)))


def test_dirichlet_partition_respects_minimum_samples_per_client():
    labels = np.array([0, 1] * 200)
    indices = _dirichlet_partition(labels, num_clients=4, alpha=0.5)

    for shard in indices:
        assert len(shard) >= 30


def test_dirichlet_partition_is_deterministic_for_a_given_seed():
    labels = np.array([0, 1] * 200)
    first = _dirichlet_partition(labels, num_clients=3, alpha=0.5, seed=7)
    second = _dirichlet_partition(labels, num_clients=3, alpha=0.5, seed=7)

    assert [sorted(shard) for shard in first] == [sorted(shard) for shard in second]


def test_dirichlet_partition_raises_when_min_samples_unreachable():
    # Only 10 samples total split across 5 clients can never reach the
    # min_samples_per_client=30 floor enforced inside _dirichlet_partition.
    labels = np.array([0, 1] * 5)
    with pytest.raises(RuntimeError):
        _dirichlet_partition(labels, num_clients=5, alpha=0.5)


def test_fedavg_continues_when_a_client_is_dropped():
    # Resilience: fedavg() doesn't know or care that a client failed —
    # the caller (run.py's _train_rounds) just omits it from both lists.
    # Only 2 of a notional 3 clients' results are passed in here.
    surviving_client_a = [np.array([0.0, 10.0])]
    surviving_client_b = [np.array([2.0, 20.0])]
    result = fedavg([surviving_client_a, surviving_client_b], weights=[100, 300])

    assert np.allclose(result[0], [1.5, 17.5])


TIERS = ["high", "mid", "low"]


def test_simulated_failure_mode_is_none_when_disabled():
    assert _simulated_failure_mode(2, 3, TIERS, False, "low", 3, "crash") is None


def test_simulated_failure_mode_is_none_on_wrong_round():
    assert _simulated_failure_mode(2, 4, TIERS, True, "low", 3, "crash") is None


def test_simulated_failure_mode_is_none_for_wrong_tier():
    # Client 0 is "high" tier; only the "low" tier client (2) should fail.
    assert _simulated_failure_mode(0, 3, TIERS, True, "low", 3, "crash") is None


def test_simulated_failure_mode_triggers_for_matching_tier_and_round():
    assert _simulated_failure_mode(2, 3, TIERS, True, "low", 3, "crash") == "crash"
    assert _simulated_failure_mode(2, 3, TIERS, True, "low", 3, "slow") == "slow"


def test_apply_magnitude_pruning_achieves_requested_sparsity():
    model = torch.nn.Sequential(torch.nn.Linear(64, 64), torch.nn.Linear(64, 8))
    sparsity = apply_magnitude_pruning(model, amount=0.3)

    assert 0.25 <= sparsity <= 0.35


def test_apply_magnitude_pruning_bakes_zeros_in_permanently():
    # prune.remove() must actually be called — otherwise the zeros only
    # exist behind a forward-hook re-parametrization, and a plain
    # state_dict() walk (get_parameters() in train_utils.py) would still
    # see the original dense weights.
    model = torch.nn.Linear(32, 32)
    apply_magnitude_pruning(model, amount=0.5)

    assert not hasattr(model, "weight_orig")
    assert (model.weight == 0).any()


def test_payload_size_bytes_shrinks_after_compression_when_sparse():
    rng = np.random.default_rng(0)
    dense = [rng.standard_normal(2000).astype(np.float32)]
    mostly_zero = [np.zeros(2000, dtype=np.float32)]
    mostly_zero[0][:100] = rng.standard_normal(100).astype(np.float32)

    dense_sizes = payload_size_bytes(dense)
    sparse_sizes = payload_size_bytes(mostly_zero)

    assert dense_sizes["raw_bytes"] == sparse_sizes["raw_bytes"]
    assert sparse_sizes["gzip_bytes"] < dense_sizes["gzip_bytes"]
