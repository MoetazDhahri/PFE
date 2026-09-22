"""Post-training model compression for the federated pipeline: magnitude
pruning (`torch.nn.utils.prune`) and post-training dynamic quantization
(`onnxruntime.quantization`).

Two different, honestly-scoped techniques are used here for two different
claims, rather than one technique asked to prove both:

- **Structural pruning** (see run.py's `ChestXraySmallCNN(c1=..., c2=...)`
  comparison run): actually shrinks the conv layers' tensors, which is
  the only thing that reduces real FLOPs/wall-clock time on dense
  hardware — this is what backs the "training time with vs without
  pruning" comparison.
- **Magnitude pruning** (`apply_magnitude_pruning` below): the standard
  `torch.nn.utils.prune` API, zeroing individual low-magnitude weights in
  an otherwise still-dense, still full-size tensor. This does **not**
  speed up PyTorch's dense matmuls — no FLOPs are skipped — so it is only
  used here for what it actually earns: a smaller *transmitted* update
  (`payload_size_bytes`, via gzip), which is pruning's real, well-known
  benefit in federated learning (communication cost between clients and
  server), not local compute speed.

Quantization (`quantize_onnx_model`) is real post-training dynamic int8
quantization via ONNX Runtime, applied to the already-exported ONNX model
— it affects on-disk size and inference latency, not training time.
"""

import gzip
import os
import time

import numpy as np
import torch
import torch.nn.utils.prune as prune


def apply_magnitude_pruning(model: torch.nn.Module, amount: float) -> float:
    """Global L1 unstructured magnitude pruning across every Conv2d/Linear
    weight tensor in `model` (in place), made permanent (zeros baked into
    the tensor, pruning re-parametrization hooks removed via
    `prune.remove`) so the model behaves like a normal module afterwards —
    including for `get_parameters()`'s plain `state_dict()` walk. Returns
    the achieved sparsity (fraction of weight elements that are exactly
    zero) across the pruned tensors.
    """
    prunable = [
        (module, "weight")
        for module in model.modules()
        if isinstance(module, (torch.nn.Conv2d, torch.nn.Linear))
    ]
    if not prunable:
        return 0.0

    prune.global_unstructured(prunable, pruning_method=prune.L1Unstructured, amount=amount)
    for module, name in prunable:
        prune.remove(module, name)

    zeros = sum(int((getattr(module, name) == 0).sum().item()) for module, name in prunable)
    total = sum(getattr(module, name).numel() for module, name in prunable)
    return zeros / total if total else 0.0


def payload_size_bytes(parameters: list[np.ndarray]) -> dict:
    """A real, verifiable proxy for one round's federated communication
    cost: total raw bytes of every parameter array, and their
    gzip-compressed size. Gzip genuinely compresses long runs of zeros, so
    magnitude-pruned (sparse) parameters measurably shrink here even
    though PyTorch's dense compute doesn't — this is the actual mechanism
    (smaller weight updates sent client<->server) that makes pruning
    worthwhile in federated learning, as opposed to a training-time
    speedup that unstructured pruning would not honestly produce.
    """
    raw = b"".join(np.ascontiguousarray(p).tobytes() for p in parameters)
    return {"raw_bytes": len(raw), "gzip_bytes": len(gzip.compress(raw))}


def quantize_onnx_model(fp32_path: str, int8_path: str) -> None:
    """Real post-training dynamic quantization (weights -> int8) via ONNX
    Runtime — not a hand-rolled approximation. Requires `onnxruntime` (see
    requirements.txt); imported lazily so importing this module doesn't
    require onnxruntime unless quantization is actually requested.
    """
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(fp32_path, int8_path, weight_type=QuantType.QUInt8)


def measure_onnx_model(model_path: str, test_loader, num_warmup_batches: int = 2) -> dict:
    """Loads an ONNX model with ONNX Runtime and measures real, on-disk
    file size, real per-batch inference wall-clock latency (CPU execution
    provider, so pruned/quantized/baseline models are all measured on the
    same hardware path), and real accuracy on the same held-out test set
    used elsewhere in run.py — so every variant is compared against
    identical ground truth rather than re-derived numbers.
    """
    import onnxruntime as ort

    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    correct = 0
    total = 0
    latencies = []
    for batch_idx, (images, labels) in enumerate(test_loader):
        images_np = images.numpy()
        start = time.perf_counter()
        logits = session.run(None, {input_name: images_np})[0]
        elapsed = time.perf_counter() - start
        if batch_idx >= num_warmup_batches:
            latencies.append(elapsed)

        predicted = logits.argmax(axis=1)
        correct += int((predicted == labels.numpy()).sum())
        total += len(labels)

    return {
        "file_size_bytes": os.path.getsize(model_path),
        "accuracy": correct / total if total else 0.0,
        "avg_batch_latency_ms": (sum(latencies) / len(latencies) * 1000) if latencies else None,
        "test_samples": total,
    }
