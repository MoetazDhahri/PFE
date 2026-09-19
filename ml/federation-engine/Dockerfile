# syntax=docker/dockerfile:1
# Real federated learning training service — direct PyTorch FedAvg loop
# (see run.py's module docstring for why this isn't Flower/Ray), GPU-
# accelerated when available. Build context is this directory:
#   docker build -t fedimg-ml ml/federation-engine
#   docker run --rm --gpus all -v "$(pwd)/ml/federation-engine/output:/app/output" fedimg-ml
#
# To run the unit tests instead of a full training run:
#   docker run --rm fedimg-ml pytest test_run.py -v

FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "run.py"]
