"""Build a synthetic Hinglish consultation → prescription dataset.

Why synthetic: fine-tuning needs hundreds of examples and the clinic has none
yet. Templated Hinglish consultations teach the model the *shape* of the task —
Indian code-switching, the "1-0-1" dosage convention, which parts of a
conversation are a prescription and which are chatter.

What this cannot teach is how this particular doctor speaks. That comes from the
real corrections captured in `ai_training_samples`; run `export_real_data.py`
once a few hundred consultations have accumulated and retrain on the union.

    python generate_dataset.py --out data/train.jsonl --n 2500
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random

from seed_medicines import MEDICINES

# ── Conversation building blocks (Hinglish, as actually spoken) ──

COMPLAINTS = {
    "fever": [
        "Doctor sahab, do din se bukhar hai aur body pain bhi hai.",
        "Mujhe kal raat se fever hai, thand lag rahi hai.",
        "Bukhar 101 tak ja raha hai, sar bhi bhaari hai.",
    ],
    "cough": [
        "Khaansi bahut hai, raat me bilkul so nahi paata.",
        "Do hafte se dry cough hai, gale me kharaash bhi hai.",
        "Cough ke saath thoda balgam bhi aa raha hai.",
    ],
    "acidity": [
        "Khaana khaane ke baad chest me jalan hoti hai.",
        "Gas aur acidity bahut rehti hai subah subah.",
        "Pet me jalan hai aur khatti dakaar aati hai.",
    ],
    "loose motion": [
        "Kal se loose motion ho raha hai, chaar paanch baar.",
        "Pet kharab hai, baar baar toilet jaana pad raha hai.",
    ],
    "pain": [
        "Ghutne me bahut dard hai, chalne me dikkat hoti hai.",
        "Kamar dard se pareshan hoon, do hafte se hai.",
    ],
    "allergy": [
        "Chheenke bahut aa rahi hain, naak behti rehti hai.",
        "Skin par rash aur khujli ho rahi hai.",
    ],
}

DOCTOR_PROBES = [
    "Achha, aur kuch takleef?",
    "Bhookh kaisi hai?",
    "Koi aur dawai chal rahi hai abhi?",
    "Pehle kabhi aisa hua tha?",
    "Neend theek aa rahi hai?",
]

PATIENT_REPLIES = [
    "Nahi doctor, bas yahi hai.",
    "Bhookh kam lag rahi hai.",
    "Nahi, koi dawai nahi le raha.",
    "Thoda kamzori mehsoos hoti hai.",
    "Baaki sab theek hai.",
]

# Chatter that must NOT become a prescription — teaches the model to ignore
# medicines the patient merely mentions.
DISTRACTORS = [
    "Mere padosi ne bola tha {med} le lo, par maine nahi li.",
    "Pehle kabhi {med} li thi par usse fayda nahi hua.",
    "Meri wife {med} leti hai, kya main bhi le sakta hoon?",
]

DOSAGES = ["1-0-1", "1-1-1", "0-0-1", "1-0-0", "0-1-0"]
TIMINGS = ["after food", "before food", ""]
DURATIONS = [3, 5, 7, 10, 15]

DOSAGE_SPOKEN = {
    "1-0-1": ["subah shaam ek ek", "din me do baar", "morning and night ek ek"],
    "1-1-1": ["din me teen baar", "subah dopahar raat"],
    "0-0-1": ["raat ko ek", "sirf raat me ek"],
    "1-0-0": ["subah ek", "sirf subah"],
    "0-1-0": ["dopahar me ek"],
}

DIAGNOSES = {
    "fever": ["Viral fever", "Acute febrile illness"],
    "cough": ["Upper respiratory tract infection", "Acute bronchitis"],
    "acidity": ["Acid peptic disease", "Gastritis"],
    "loose motion": ["Acute gastroenteritis"],
    "pain": ["Osteoarthritis", "Mechanical low back pain"],
    "allergy": ["Allergic rhinitis", "Urticaria"],
}

ADVICE = {
    "fever": ["Plenty of fluids", "Rest for 2-3 days", "Tepid sponging if fever is high"],
    "cough": ["Steam inhalation twice a day", "Avoid cold drinks", "Warm salt water gargle"],
    "acidity": ["Avoid spicy and oily food", "Small frequent meals", "Do not lie down right after eating"],
    "loose motion": ["ORS after every loose stool", "Avoid outside food", "Plenty of fluids"],
    "pain": ["Hot fomentation", "Avoid squatting and stairs", "Physiotherapy exercises"],
    "allergy": ["Avoid dust exposure", "Use a mask outdoors"],
}


def _by_indication(indication: str):
    return [m for m in MEDICINES if m[3] == indication] or MEDICINES


def build_sample(rng: random.Random) -> dict:
    indication = rng.choice(list(COMPLAINTS.keys()))
    lines: list[str] = []

    # Opening exchange.
    lines.append(f"Doctor: Namaste, baithiye. Kya taklif hai?")
    lines.append(f"Patient: {rng.choice(COMPLAINTS[indication])}")
    for _ in range(rng.randint(1, 3)):
        lines.append(f"Doctor: {rng.choice(DOCTOR_PROBES)}")
        lines.append(f"Patient: {rng.choice(PATIENT_REPLIES)}")

    # Sometimes the patient names a medicine that was never prescribed.
    if rng.random() < 0.35:
        distractor = rng.choice(DISTRACTORS).format(med=rng.choice(MEDICINES)[0])
        lines.append(f"Patient: {distractor}")

    diagnosis = rng.choice(DIAGNOSES[indication])
    lines.append(f"Doctor: Dekhiye, ye {diagnosis.lower()} lag raha hai.")

    # The actual prescription.
    pool = _by_indication(indication)
    extra = [m for m in MEDICINES if m[3] in ("vitamin", "acidity")]
    chosen = rng.sample(pool, min(len(pool), rng.randint(1, 2)))
    if rng.random() < 0.5:
        chosen.append(rng.choice(extra))

    medicines = []
    for name, strength, form, _ in chosen:
        dosage = rng.choice(DOSAGES)
        timing = rng.choice(TIMINGS)
        days = rng.choice(DURATIONS)
        spoken_dose = rng.choice(DOSAGE_SPOKEN[dosage])
        spoken_timing = " khaane ke baad" if timing == "after food" else (
            " khaane se pehle" if timing == "before food" else ""
        )
        lines.append(
            f"Doctor: {name} {strength} {spoken_dose}{spoken_timing}, {days} din."
        )
        medicines.append(
            {
                "name": name,
                "strength": strength,
                "form": form,
                "dosage": dosage,
                "timing": timing,
                "duration_days": days,
                "instructions": "",
            }
        )

    # Every advice line in the target must actually be spoken, otherwise the
    # data teaches the model to invent advice the doctor never gave.
    advice = rng.sample(ADVICE[indication], k=min(2, len(ADVICE[indication])))
    lines.append(f"Doctor: {'. '.join(advice)}.")

    # Same for follow-up: the spoken phrase and the number must agree.
    follow_up_days = rng.choice([None, 3, 7])
    if follow_up_days == 3:
        lines.append("Doctor: Teen din baad dikhana.")
    elif follow_up_days == 7:
        lines.append("Doctor: Ek hafte baad follow up.")
    else:
        lines.append("Doctor: Zarurat pade to aa jaana.")

    lines.append("Patient: Theek hai doctor, dhanyavaad.")

    return {
        "transcript": "\n".join(lines),
        "prescription": {
            "diagnosis": diagnosis,
            "medicines": medicines,
            "advice": advice,
            "follow_up_days": follow_up_days,
        },
    }


def to_chat(sample: dict, system: str) -> dict:
    """MLX-LM chat format: {"messages": [...]}"""
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": sample["transcript"]},
            {
                "role": "assistant",
                "content": json.dumps(sample["prescription"], ensure_ascii=False),
            },
        ]
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data")
    parser.add_argument("--n", type=int, default=2500)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    # Reuse the production prompt so training and serving stay aligned.
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from app.prompts.prescription import SYSTEM

    rng = random.Random(args.seed)
    samples = [build_sample(rng) for _ in range(args.n)]

    # 80/10/10 — MLX-LM expects train.jsonl / valid.jsonl / test.jsonl.
    n_train = int(len(samples) * 0.8)
    n_valid = int(len(samples) * 0.1)
    splits = {
        "train": samples[:n_train],
        "valid": samples[n_train : n_train + n_valid],
        "test": samples[n_train + n_valid :],
    }

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in splits.items():
        path = out / f"{name}.jsonl"
        with path.open("w") as fh:
            for row in rows:
                fh.write(json.dumps(to_chat(row, SYSTEM), ensure_ascii=False) + "\n")
        print(f"{path}: {len(rows)} samples")


if __name__ == "__main__":
    main()
