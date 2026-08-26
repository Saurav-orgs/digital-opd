from __future__ import annotations

from typing import Any

VERSION = "report_summary/v5"

SYSTEM = """You are an expert clinical pathologist and medical report analyzer.
Your job is to generate a concise, clinically accurate executive summary of the patient's diagnostic lab reports and ECG for the consulting doctor.

YOU ARE GIVEN TWO THINGS:
  A. VERIFIED FINDINGS — values the laboratory engine read and range-checked.
     These are authoritative. Never contradict or recalculate them.
  B. DOCUMENT TEXT — the report itself, verbatim. This is your source for
     everything the engine could not structure. Many perfectly good reports
     (radiology, ECG narratives, discharge summaries, and lab layouts the
     engine does not recognise) yield NO verified findings at all. Summarise
     those from the document text — do not treat an empty verified section as
     evidence that the patient is fine.

0. WHEN NOTHING WAS VERIFIED, NEVER IMPLY NORMALITY:
   - An empty verified section means "not measured by the engine", NOT "normal".
   - Never write "all parameters are within reference intervals", "no abnormal
     findings" or similar unless actual values were verified and were in range,
     or the document itself states that conclusion.
   - If the document text carries readable clinical content, summarise THAT.
   - If the document is not a patient report at all — a textbook table, a
     classification chart, a reference article, a blank or unrelated page — say
     exactly that in one sentence (e.g. "This file is a reference table on
     dengue classification, not a patient report; it contains no results for
     this patient.") and leave key_findings empty.

CRITICAL CLINICAL GROUNDING RULES:
1. STRICT DYNAMIC SCOPE (NO EVIDENCE = DO NOT MENTION):
   - The summary MUST ONLY contain findings supported by the data below.
   - If the report contains 1 test, summarize ONLY that 1 test.
   - If the report contains no ECG, NEVER mention ECG.
   - If the report contains no cardiovascular panel, NEVER mention cardiovascular risk or lipid profile.
   - If the report contains no electrolyte panel, NEVER mention electrolytes.
   - If the report contains no liver/kidney/vitamin panel, NEVER claim those panels are normal.
   - NEVER assume the report is a "comprehensive health check" unless multi-organ tests are explicitly present.
2. AUTHORITATIVE LAB DATA:
   - The laboratory status flags ([LOW], [HIGH], [NORMAL], [ABNORMAL]) provided below are mathematically verified by the clinical laboratory engine.
   - DO NOT recalculate, change, or contradict these statuses. If a test is flagged [LOW] (e.g. Ferritin 9.9), NEVER say it is normal. If flagged [HIGH] (e.g. Glucose 245), NEVER say it is normal.
   - If ANY abnormal result exists, NEVER state "all parameters are normal" or "no abnormalities found".
3. CLINICAL SYNTHESIS:
   - In `summary`: State the patient demographics (if available) and clearly report the measured abnormal values against their reference intervals. If normal panels were tested, summarize them briefly.
   - In `key_findings`: List high-yield bullet observations (one bullet per distinct finding).
   - In `report_type`: State the specific panel type (e.g., "Fasting Blood Sugar", "Complete Blood Count", "Diagnostic Report").
4. DO NOT COPY IRRELEVANT LAB COMMENTARY:
   - Do NOT copy generic educational notes (e.g. pregnancy reference ranges for a 62-year-old male, circadian rhythms, general disclaimers)."""

USER_TEMPLATE = """Patient Report Data:

{structured_ir_text}

Generate the doctor-facing clinical summary."""


# The document text is the model's only source when the engine parses nothing,
# so it must be big enough to carry a whole report. Real lab PDFs here run to
# ~18k characters; beyond that the verified section is doing the work anyway.
MAX_RAW_TEXT_CHARS = 20000


def build_user_from_ir(ir: Any, raw_text: str = "") -> str:
    """Build the summariser prompt from verified findings PLUS the document text.

    `raw_text` used to be accepted and then silently dropped, so on any report
    the parser could not structure the model received nothing but an empty
    scaffold saying "No out-of-range parameters found / No specific normal
    panels parsed" — and dutifully paraphrased it into "no abnormal findings,
    all parameters within reference intervals", identically for every such
    report. The document text is the fix: it lets the model summarise what the
    report actually says instead of describing the empty scaffold.
    """
    parsed_anything = bool(ir.all_results or ir.ecg_findings)

    lines = [
        f"Patient: {ir.patient_name or 'Patient'} | Age/Sex: {ir.age or 'Adult'} {ir.gender} | Date: {ir.date or 'Recent'}",
        "\n=== MATHEMATICALLY VERIFIED ABNORMAL FINDINGS ===",
    ]
    if ir.abnormal_results or ir.ecg_findings or getattr(ir, "radiology_findings", []) or getattr(ir, "pft_findings", []):
        for r in ir.abnormal_results:
            lines.append(f"• [{r.status}] {r.test_name}: {r.value} {r.unit} (Ref: {r.reference_raw}) [Panel: {r.category}]")
        for ecg in ir.ecg_findings:
            lines.append(f"• [ABNORMAL] ECG Finding: {ecg} [Panel: Cardiology / ECG]")
        for rad in getattr(ir, "radiology_findings", []):
            lines.append(f"• [ABNORMAL] Radiology / Ultrasound Finding: {rad} [Panel: Radiology / Ultrasound]")
        for pft in getattr(ir, "pft_findings", []):
            lines.append(f"• [ABNORMAL] Pulmonary Function Test (PFT) Finding: {pft} [Panel: Pulmonology / PFT]")
    elif parsed_anything:
        lines.append("None — every value the engine read was inside its reference interval.")
    else:
        # Say "unmeasured", never "fine". The old wording here asserted an
        # all-clear the engine had no basis for.
        lines.append(
            "The engine could not read ANY values from this document. NOTHING is "
            "verified. This is NOT evidence that the results are normal — "
            "summarise from the DOCUMENT TEXT below instead."
        )

    lines.append("\n=== MATHEMATICALLY VERIFIED NORMAL ORGAN PANELS ===")
    grouped_norm = ir.grouped_normals()
    if not grouped_norm:
        lines.append(
            "None parsed."
            if parsed_anything
            else "None parsed — again, this means unmeasured, not normal."
        )
    else:
        for cat, results in grouped_norm.items():
            tests_str = ", ".join(f"{r.test_name} ({r.value} {r.unit})" for r in results)
            lines.append(f"• {cat}: {tests_str} — ALL WITHIN NORMAL LIMITS")

    body = raw_text.strip()
    if body:
        lines.append(
            "\n=== DOCUMENT TEXT (verbatim — your source for anything not verified above) ==="
        )
        lines.append(body[:MAX_RAW_TEXT_CHARS])
    else:
        lines.append("\n=== DOCUMENT TEXT ===\n(No text could be extracted from this file.)")

    return USER_TEMPLATE.format(structured_ir_text="\n".join(lines))


def build_user(document_text: str, was_ocr: bool) -> str:
    return USER_TEMPLATE.format(structured_ir_text=document_text)
