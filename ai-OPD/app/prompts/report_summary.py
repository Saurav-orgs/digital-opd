from __future__ import annotations

from typing import Any

VERSION = "report_summary/v4"

SYSTEM = """You are an expert clinical pathologist and medical report analyzer.
Your job is to generate a concise, clinically accurate executive summary of the patient's diagnostic lab reports and ECG for the consulting doctor.

CRITICAL CLINICAL GROUNDING RULES:
1. STRICT DYNAMIC SCOPE (NO EVIDENCE = DO NOT MENTION):
   - The summary MUST ONLY contain findings supported by the extracted data below.
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


def build_user_from_ir(ir: Any, raw_text: str = "") -> str:
    lines = [
        f"Patient: {ir.patient_name or 'Patient'} | Age/Sex: {ir.age or 'Adult'} {ir.gender} | Date: {ir.date or 'Recent'}",
        "\n=== MATHEMATICALLY VERIFIED ABNORMAL FINDINGS ===",
    ]
    if not ir.abnormal_results and not ir.ecg_findings:
        lines.append("No out-of-range parameters found.")
    else:
        for r in ir.abnormal_results:
            lines.append(f"• [{r.status}] {r.test_name}: {r.value} {r.unit} (Ref: {r.reference_raw}) [Panel: {r.category}]")
        for ecg in ir.ecg_findings:
            lines.append(f"• [ABNORMAL] ECG Finding: {ecg} [Panel: Cardiology / ECG]")

    lines.append("\n=== MATHEMATICALLY VERIFIED NORMAL ORGAN PANELS ===")
    grouped_norm = ir.grouped_normals()
    if not grouped_norm:
        lines.append("No specific normal panels parsed.")
    else:
        for cat, results in grouped_norm.items():
            tests_str = ", ".join(f"{r.test_name} ({r.value} {r.unit})" for r in results)
            lines.append(f"• {cat}: {tests_str} — ALL WITHIN NORMAL LIMITS")

    return USER_TEMPLATE.format(structured_ir_text="\n".join(lines))


def build_user(document_text: str, was_ocr: bool) -> str:
    return USER_TEMPLATE.format(structured_ir_text=document_text)
