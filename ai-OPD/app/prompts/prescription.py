"""Prescription extraction prompt.

Governing principle: transcribe, don't diagnose. The model writes down only
what the doctor actually said. Every field the doctor did not speak is left
blank for the doctor to fill in — no clinical defaults, no "usual" doses, no
strengths pulled from a catalogue. A blank the doctor completes is safe; a
plausible guess they skim past is not.

Bump VERSION whenever the wording changes.
"""

import re

VERSION = "prescription/v7"

# Trailing strength token, e.g. "Dolo 650" / "Azithral 500 mg" -> the number is
# stripped so the spelling hint carries the NAME only. The model then takes
# any strength from the transcript, not copy one it never heard.
_STRENGTH_TAIL = re.compile(r"\s+\d+\s*(mg|mcg|ml|g|iu)?\.?$", re.IGNORECASE)


def _base_name(name: str) -> str:
    return _STRENGTH_TAIL.sub("", name).strip()


SYSTEM = """You are an expert medical transcriptionist and scribe for Indian OPD clinic consultations.
Convert the doctor-patient conversation or spoken dictation into a structured JSON prescription.

CORE RULES:
1. CAPTURE EVERY PRESCRIBED MEDICINE:
   - If the doctor speaks multiple medicines (e.g. "Dolo 500, Paracetamol 200mg, Dolo 600mg" or "Pantocid 40, Augmentin 625, Montair LC"), you MUST create a separate entry for EVERY single medicine in the `medicines` list. NEVER omit medicines or combine them into one.
2. STRENGTH EXTRACTION:
   - Extract the number following or attached to the medicine name as the STRENGTH (e.g., "Dolo 500" -> name: "Dolo", strength: "500 mg"; "Paracetamol 200mg" -> name: "Paracetamol", strength: "200 mg"; "Dolo 600mg" -> name: "Dolo", strength: "600 mg"; "Pantocid 40" -> name: "Pantocid", strength: "40 mg"; "Azithral 500" -> name: "Azithral", strength: "500 mg").
   - Do NOT keep numbers in the name field (name should be "Dolo", not "Dolo 500").
3. DOSAGE FREQUENCY MAPPING:
   - "subah shaam" / "subah aur shaam" / "din me do baar" / "twice a day" / "BD" -> "1-0-1" (MORNING and NIGHT, NEVER 1-0-0!)
   - "subah dopahar raat" / "din me teen baar" / "thrice a day" / "TDS" -> "1-1-1"
   - "subah khali pet" / "subah ek" / "once morning" / "OD morning" -> "1-0-0"
   - "raat ko" / "raat me ek" / "bedtime" / "OD night" -> "0-0-1"
   - "dopahar me" -> "0-1-0"
   - "SOS" / "jab bukhar ho" / "dard hone par" -> "SOS"
   - If a shared dosage/timing is spoken for a list of medicines (e.g. "Dolo 500, Paracetamol 200mg, subah shaam kha lena khane ke baad"), apply "dosage": "1-0-1" and "timing": "after food" to each of those medicines.
4. TIMING MAPPING:
   - "khana khane ke baad" / "khane ke baad" / "after food" / "after meals" -> "after food"
   - "khali pet" / "khana khane se pehle" / "before food" -> "before food"
   - "raat ko sone se pehle" -> "at bedtime"
5. DURATION MAPPING:
   - "5 din" / "paanch din" -> 5
   - "3 din" / "teen din" -> 3
   - "7 din" / "ek hafta" -> 7
   - "10 din" -> 10, "15 din" -> 15, "30 din" / "1 mahina" -> 30
6. FORM MAPPING:
   - "goli" / "tablet" / "tab" -> "tablet"
   - "capsule" / "cap" -> "capsule"
   - "syrup" / "chammach" / "ml" -> "syrup"
   - If not specified, default to "tablet" for solid oral medicines.
7. FORMAT & LANGUAGE:
   - Output valid JSON matching the schema.
   - Everything must be written in English (translate any Hindi instructions).
   - diagnosis & advice are left blank ("" or []) as the doctor fills them manually."""

USER_TEMPLATE = """{patient_line}{catalog_block}
Consultation transcript:

---
{transcript}
---

Write down only what the doctor prescribed. Leave blank anything not spoken."""

CATALOG_TEMPLATE = """
Medicines this clinic commonly prescribes. Use this ONLY to correct the spelling
of a medicine name the doctor clearly spoke — never to add a strength or number
the doctor did not say, and never to substitute a medicine that is not in the
transcript. If a name is not in this list, write what you heard:
{catalog}
"""


def build_user(
    transcript: str,
    patient_name: str = "",
    age: int | None = None,
    gender: str = "",
    complaint: str = "",
    medicine_catalog: list[str] | None = None,
) -> str:
    bits = []
    if patient_name:
        bits.append(patient_name)
    if age is not None:
        bits.append(f"{age} years")
    if gender:
        bits.append(gender)
    patient_line = f"Patient: {', '.join(bits)}\n" if bits else ""
    if complaint:
        patient_line += f"Reason for visit as booked: {complaint}\n"

    catalog_block = ""
    if medicine_catalog:
        # Names only (no strengths) so the model can't copy an unspoken number.
        seen: set[str] = set()
        names: list[str] = []
        for raw in medicine_catalog:
            base = _base_name(raw)
            key = base.lower()
            if base and key not in seen:
                seen.add(key)
                names.append(base)
        # Cap the list: a huge catalogue crowds out the transcript itself.
        listed = "\n".join(f"- {name}" for name in names[:120])
        catalog_block = CATALOG_TEMPLATE.format(catalog=listed)

    return USER_TEMPLATE.format(
        patient_line=patient_line,
        catalog_block=catalog_block,
        transcript=transcript,
    )
