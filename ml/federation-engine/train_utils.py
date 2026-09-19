from collections import OrderedDict

import torch
import torch.nn as nn
from opacus import PrivacyEngine
from torch.utils.data import DataLoader


def get_parameters(model: nn.Module):
    return [val.cpu().numpy() for _, val in model.state_dict().items()]


def set_parameters(model: nn.Module, parameters) -> None:
    params_dict = zip(model.state_dict().keys(), parameters)
    state_dict = OrderedDict({k: torch.tensor(v) for k, v in params_dict})
    model.load_state_dict(state_dict, strict=True)


def train_with_dp(
    model: nn.Module,
    loader: DataLoader,
    epochs: int,
    device: torch.device,
    privacy_engine: PrivacyEngine,
    noise_multiplier: float,
    max_grad_norm: float,
    delta: float,
    lr: float = 0.001,
) -> float:
    """Real DP-SGD: per-example gradient clipping (max_grad_norm) plus
    calibrated Gaussian noise (noise_multiplier), via Opacus. Returns the
    actual (epsilon, delta)-DP guarantee for everything trained through
    `privacy_engine` so far, computed by Opacus's RDP accountant — not a
    hand-rolled approximation.

    `privacy_engine` is created once per client (see run.py) and passed in
    fresh each round: the same accountant instance keeps composing privacy
    loss across every round that client has trained in, which is what
    actually determines its cumulative epsilon — resetting the accountant
    every round would silently under-report how much privacy has been
    spent. `model`'s parameters are updated in place (Opacus wraps the same
    module object, it doesn't copy it), so callers can read them back with
    get_parameters(model) exactly as with the non-DP `train()`.
    """
    model.to(device)
    model.train()
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    private_model, private_optimizer, private_loader = privacy_engine.make_private(
        module=model,
        optimizer=optimizer,
        data_loader=loader,
        noise_multiplier=noise_multiplier,
        max_grad_norm=max_grad_norm,
    )

    for _ in range(epochs):
        for images, labels in private_loader:
            images, labels = images.to(device), labels.to(device)
            private_optimizer.zero_grad()
            loss = criterion(private_model(images), labels)
            loss.backward()
            private_optimizer.step()

    return privacy_engine.get_epsilon(delta=delta)


@torch.no_grad()
def test(model: nn.Module, loader: DataLoader, device: torch.device):
    model.to(device)
    model.eval()
    criterion = nn.CrossEntropyLoss()
    correct, total, loss_sum = 0, 0, 0.0
    true_positive = false_positive = true_negative = false_negative = 0
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        outputs = model(images)
        loss_sum += criterion(outputs, labels).item() * labels.size(0)
        predicted = outputs.argmax(dim=1)
        correct += (predicted == labels).sum().item()
        total += labels.size(0)
        true_positive += ((predicted == 1) & (labels == 1)).sum().item()
        false_positive += ((predicted == 1) & (labels == 0)).sum().item()
        true_negative += ((predicted == 0) & (labels == 0)).sum().item()
        false_negative += ((predicted == 0) & (labels == 1)).sum().item()

    accuracy = correct / total if total else 0.0
    avg_loss = loss_sum / total if total else 0.0
    sensitivity = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
    specificity = true_negative / (true_negative + false_positive) if (true_negative + false_positive) else 0.0
    return avg_loss, accuracy, sensitivity, specificity
