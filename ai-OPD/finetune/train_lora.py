"""LoRA fine-tune the prescription-drafting model on Apple Silicon (MLX).

MLX trains on the M-series GPU, so this runs on the demo laptop — a small
adapter over Qwen2.5-3B takes a couple of hours rather than needing a rented GPU.

    pip install mlx-lm
    python generate_dataset.py --out data --n 2500
    python train_lora.py --iters 600

Produces `adapters/`. Point the service at it with LORA_ADAPTER_PATH and restart;
unset it to fall back to the base model. Always run evaluate.py first — keep the
adapter only if it actually beats the base model.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="Qwen/Qwen2.5-3B-Instruct")
    parser.add_argument("--data", default=os.path.join(here, "data"))
    parser.add_argument("--adapter-path", default=os.path.join(here, "adapters"))
    parser.add_argument("--iters", type=int, default=600)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--num-layers", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--max-seq-length", type=int, default=1024)
    parser.add_argument("--val-batches", type=int, default=5)
    args = parser.parse_args()

    cmd = [
        sys.executable, "-m", "mlx_lm", "lora",
        "--model", args.model,
        "--train",
        "--data", args.data,
        "--adapter-path", args.adapter_path,
        "--iters", str(args.iters),
        "--batch-size", str(args.batch_size),
        "--num-layers", str(args.num_layers),
        "--learning-rate", str(args.learning_rate),
        "--max-seq-length", str(args.max_seq_length),
        "--val-batches", str(args.val_batches),
        "--grad-checkpoint",
        "--steps-per-eval", "25",
        "--save-every", "50",
    ]
    print("Running:", " ".join(cmd), flush=True)

    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        sys.exit("mlx-lm is not installed. Run: pip install mlx-lm")
    except subprocess.CalledProcessError as err:
        sys.exit(f"Training failed (exit {err.returncode}).")

    print(
        f"\nAdapter written to {args.adapter_path}/\n"
        "Next: python evaluate.py --adapter-path "
        f"{args.adapter_path}  — and only ship it if it wins."
    )


if __name__ == "__main__":
    main()
