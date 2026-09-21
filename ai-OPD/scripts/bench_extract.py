"""Time prescription extraction over stored transcripts.

    PYTHONPATH=. .venv/bin/python scripts/bench_extract.py BENCH_DIR

BENCH_DIR holds `<name>.txt` transcripts and, optionally, `<name>.json` with
the medicines the doctor actually issued (`[{"name": ..., "dosage": ...}]`
or the full draft object). Each transcript is sent to a running ai-OPD
(`AI_URL`, default http://127.0.0.1:8000) and the wall time and the medicine
names recalled are printed.

Change one thing between runs — AI_CLAUDE_EXTRACT_EFFORT, AI_CLAUDE_EXTRACT_MODEL
or AI_CLAUDE_FAST on the service — and compare the two tables.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx


def _names(medicines: list[dict]) -> set[str]:
    return {m.get("name", "").strip().lower() for m in medicines if m.get("name")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bench_dir", type=Path)
    args = ap.parse_args()
    url = os.environ.get("AI_URL", "http://127.0.0.1:8000")

    transcripts = sorted(args.bench_dir.glob("*.txt"))
    if not transcripts:
        print(f"no .txt transcripts in {args.bench_dir}", file=sys.stderr)
        return 1

    with httpx.Client(timeout=180) as c:
        health = c.get(f"{url}/health").json()
        print(f"ai-OPD {url} llm={health.get('llm_model')}\n")

        walls: list[float] = []
        recalls: list[float] = []
        for path in transcripts:
            transcript = path.read_text().strip()
            ref_path = path.with_suffix(".json")
            ref = json.loads(ref_path.read_text()) if ref_path.exists() else None
            if isinstance(ref, dict):
                ref = ref.get("medicines", [])

            t = time.monotonic()
            r = c.post(
                f"{url}/extract-prescription",
                json={
                    "transcript": transcript,
                    "patient": {"name": "Bench", "age": 40, "gender": "", "complaint": ""},
                    "medicine_catalog": [],
                },
            )
            wall = time.monotonic() - t
            walls.append(wall)
            if r.status_code != 200:
                print(f"{path.name:32} FAILED {r.status_code}: {r.text[:120]}")
                continue
            got = r.json()["prescription"]["medicines"]
            line = f"{path.name:32} {len(transcript):5d} chars  {wall:5.1f}s  {len(got)} medicines"
            if ref:
                want = _names(ref)
                hit = len(want & _names(got)) / len(want) if want else 1.0
                recalls.append(hit)
                missing = sorted(want - _names(got))
                line += f"  recall {hit:.0%}" + (f"  missing: {', '.join(missing)}" if missing else "")
            print(line)

    walls.sort()
    print(f"\n{len(walls)} transcripts — median {walls[len(walls) // 2]:.1f}s, max {walls[-1]:.1f}s")
    if recalls:
        print(f"mean medicine recall {sum(recalls) / len(recalls):.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
