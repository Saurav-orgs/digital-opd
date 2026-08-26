"""Export the doctor's real corrections into training data.

Every issued prescription writes an `ai_training_samples` row holding the
transcript the model saw and the prescription the doctor actually signed off.
That is genuine supervised data for this clinic — this doctor's phrasing, this
doctor's formulary, this doctor's dosing habits — and it will beat the synthetic
set by a wide margin once a few hundred consultations have accumulated.

    python export_real_data.py --out data_real
    # then train on the union of data/ and data_real/

Rows where the doctor changed nothing are kept deliberately: they teach the model
which of its outputs were already right.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.prompts.prescription import SYSTEM  # noqa: E402
from app.prompts import progress as progress_prompt  # noqa: E402


def dosage_of(medicine: dict) -> str:
    return (medicine.get("dosage") or "").strip()


def to_target(doctor_output: dict) -> dict:
    """Reshape a stored prescription into the model's output schema."""
    return {
        "diagnosis": doctor_output.get("diagnosis") or "",
        "medicines": [
            {
                "name": m.get("medicine_name", ""),
                "strength": m.get("strength") or "",
                "form": m.get("form") or "",
                "dosage": dosage_of(m),
                "timing": m.get("timing") or "",
                "duration_days": m.get("duration_days"),
                "instructions": m.get("instructions") or "",
            }
            for m in doctor_output.get("medicines", [])
        ],
        "advice": [
            line.strip()
            for line in (doctor_output.get("advice") or "").split("\n")
            if line.strip()
        ],
        "follow_up_days": None,
    }


def progress_sample(input_payload: dict, doctor_output: dict) -> dict | None:
    """One across-visits correction, rendered as a training pair.

    The user turn is rebuilt with the same prompt builder the live endpoint
    uses, so what the model trains on is exactly what it will be asked at
    inference — including the COMPARABLE / NEW THIS VISIT split that keeps it
    from claiming a trend it cannot support.
    """
    previous = (input_payload or {}).get("previous")
    current = (input_payload or {}).get("current")
    if not previous or not current:
        return None
    if not (current.get("reports") and previous.get("reports")):
        return None

    user = progress_prompt.build_user(
        (input_payload or {}).get("patient") or {},
        previous,
        current,
    )
    return {
        "messages": [
            {"role": "system", "content": progress_prompt.SYSTEM},
            {"role": "user", "content": user},
            {
                "role": "assistant",
                "content": json.dumps(doctor_output or {}, ensure_ascii=False),
            },
        ]
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data_real")
    parser.add_argument(
        "--kind",
        default="prescription",
        choices=["prescription", "progress_summary"],
        help="Which corrections to export.",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="postgresql://user:pass@host:5432/dbname",
    )
    parser.add_argument("--min-samples", type=int, default=50)
    args = parser.parse_args()

    if not args.database_url:
        sys.exit(
            "Pass --database-url or set DATABASE_URL, e.g.\n"
            "  postgresql://user:pass@localhost:5432/digital-opd"
        )

    try:
        import psycopg2  # noqa: PLC0415
    except ImportError:
        sys.exit("pip install psycopg2-binary")

    conn = psycopg2.connect(args.database_url)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT input_payload, doctor_output, edited
            FROM ai_training_samples
            WHERE kind = %s
            ORDER BY created_at ASC
            """,
            (args.kind,),
        )
        rows = cur.fetchall()
    conn.close()

    samples = []
    for input_payload, doctor_output, _edited in rows:
        if args.kind == "progress_summary":
            sample = progress_sample(input_payload or {}, doctor_output or {})
            if sample:
                samples.append(sample)
            continue

        transcript = (input_payload or {}).get("transcript", "").strip()
        if not transcript:
            continue
        samples.append(
            {
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": transcript},
                    {
                        "role": "assistant",
                        "content": json.dumps(
                            to_target(doctor_output or {}), ensure_ascii=False
                        ),
                    },
                ]
            }
        )

    label = "consultation" if args.kind == "prescription" else "visit comparison"
    print(f"Found {len(samples)} usable {label}(s).")
    if len(samples) < args.min_samples:
        print(
            f"That is below --min-samples ({args.min_samples}). Fine-tuning on "
            "too little real data mostly memorises it; keep collecting."
        )
        if not samples:
            return

    n_train = max(1, int(len(samples) * 0.8))
    n_valid = max(1, int(len(samples) * 0.1)) if len(samples) > 2 else 0
    splits = {
        "train": samples[:n_train],
        "valid": samples[n_train : n_train + n_valid],
        "test": samples[n_train + n_valid :],
    }

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, chunk in splits.items():
        if not chunk:
            continue
        path = out / f"{name}.jsonl"
        with path.open("w") as fh:
            for row in chunk:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{path}: {len(chunk)} samples")


if __name__ == "__main__":
    main()
