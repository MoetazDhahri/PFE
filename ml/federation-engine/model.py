"""A small CNN for 28x28 grayscale chest X-ray classification. Deliberately
not DenseNet-121 (the architecture named in the product's Knowledge Center
for the chest-xray track) — this repo's compute budget for a first real
training run is one consumer GPU, not a cluster, so a small CNN that
actually trains in minutes was chosen over a heavier architecture that
would not finish in a reasonable demo window. That gap is documented, not
hidden — see docs/production-readiness.md.

`c1`/`c2` (conv1/conv2 output channels, default 16/32) are constructor
args rather than hardcoded so optimize.py's structured-pruning comparison
can build a genuinely smaller version of this same architecture (fewer
channels = fewer real FLOPs = a real measured training-time difference),
instead of only zeroing weights in a still-dense, still-full-size tensor.
"""

import torch.nn as nn
import torch.nn.functional as F


class ChestXraySmallCNN(nn.Module):
    def __init__(self, c1: int = 16, c2: int = 32):
        super().__init__()
        self.conv1 = nn.Conv2d(1, c1, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(c1, c2, kernel_size=3, padding=1)
        self.pool = nn.MaxPool2d(2, 2)
        self.fc1 = nn.Linear(c2 * 7 * 7, 64)
        self.fc2 = nn.Linear(64, 2)

    def forward(self, x):
        x = self.pool(F.relu(self.conv1(x)))  # 28 -> 14
        x = self.pool(F.relu(self.conv2(x)))  # 14 -> 7
        x = x.view(x.size(0), -1)
        x = F.relu(self.fc1(x))
        return self.fc2(x)
