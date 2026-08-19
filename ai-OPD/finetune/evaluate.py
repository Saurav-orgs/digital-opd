"""Score the drafting model on held-out consultations, base vs fine-tuned.

The metrics are the ones that matter clinically, not perplexity:

  json_valid        did it produce a usable object at all
  medicine_recall   of the medicines actually prescribed, how many were caught
  medicine_precision of the medicines it listed, how many were real
                     (this is the hallucination metric — the dangerous one)
  dosage_exact      of correctly-named medicines, how many had the right dosage

    python evaluate.py                      # base model
    python evaluate.py --adapter-path adapters   # fine-tuned

Keep the adapter only if precision holds and recall improves. A model that
invents medicines is worse than one that misses them: the doctor adds what is
missing, but may not catch what was fabricated.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.schemas import PRESCRIPTION_JSON_SCHEMA  # noqa: E402


def norm(name: str) -> str:
    return " ".join(name.lower().split())


def ask_ollama(model: str, system: str, user: str) -> dict | None:
    try:
        res = httpx.post(
            f"{settings.ollama_url}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "format": PRESCRIPTION_JSON_SCHEMA,
                "stream": False,
                "options": {"temperature": 0},
            },
            timeout=300,
        )
        res.raise_for_status()
        return json.loads(res.json()["message"]["content"])
    except Exception as err:
        print(f"  ! {err}", file=sys.stderr)
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", default="data/test.jsonl")
    parser.add_argument("--model", default=settings.llm_model)
    parser.add_argument(
        "--adapter-path",
        default="",
        help="Reported in the header only; serve the adapter via Ollama or "
        "mlx_lm.server and point --model at it.",
    )
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    rows = [json.loads(line) for line in open(args.test)][: args.limit]
    if not rows:
        sys.exit("No test rows — run generate_dataset.py first.")

    print(f"Model: {args.model}{'  + ' + args.adapter_path if args.adapter_path else '  (base)'}")
    print(f"Samples: {len(rows)}\n")

    json_valid = 0
    tp = fp = fn = 0          # medicine name matching
    dosage_hits = dosage_total = 0
    diagnosis_hits = 0

    for i, row in enumerate(rows, 1):
        system = row["messages"][0]["content"]
        user = row["messages"][1]["content"]
        expected = json.loads(row["messages"][2]["content"])

        got = ask_ollama(args.model, system, user)
        if got is None:
            fn += len(expected["medicines"])
            continue
        json_valid += 1

        exp_by_name = {norm(m["name"]): m for m in expected["medicines"]}
        got_by_name = {norm(m.get("name", "")): m for m in got.get("medicines", [])}

        for name, exp_med in exp_by_name.items():
            if name in got_by_name:
                tp += 1
                dosage_total += 1
                if (got_by_name[name].get("dosage") or "").strip() == exp_med["dosage"]:
                    dosage_hits += 1
            else:
                fn += 1
        for name in got_by_name:
            if name not in exp_by_name:
                fp += 1

        if norm(got.get("diagnosis", "")) == norm(expected["diagnosis"]):
            diagnosis_hits += 1

        print(f"  [{i}/{len(rows)}]", end="\r", flush=True)

    n = len(rows)
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0

    print("\n" + "─" * 46)
    print(f"json_valid         {json_valid / n:6.1%}")
    print(f"medicine_recall    {recall:6.1%}   ({tp} found, {fn} missed)")
    print(f"medicine_precision {precision:6.1%}   ({fp} invented)")
    print(f"dosage_exact       {(dosage_hits / dosage_total if dosage_total else 0):6.1%}")
    print(f"diagnosis_exact    {diagnosis_hits / n:6.1%}")
    print("─" * 46)
    if fp:
        print(
            f"\n{fp} invented medicine(s). Precision matters more than recall "
            "here — a fabricated line can reach a patient if the doctor skims."
        )


if __name__ == "__main__":
    main()
