"""Post-generation Contradiction Guard & Medical Consistency Validator.

Cross-references LLM-generated summary narrative against authoritatively
verified LabResult records:
1. Enforces deterministic abnormal values list.
2. Rejects and corrects contradictory statements (e.g., claiming a LOW ferritin is normal).
3. Enforces Source-Grounded Generation Rule: NO EVIDENCE = DO NOT MENTION.
   - If report has 1 test -> summarize only 1 test.
   - If report has NO ECG -> never mention ECG.
   - If report has NO cardiovascular/electrolyte/liver/kidney tests -> never mention or claim normal.
   - If ANY abnormal result exists -> strictly reject "all results normal".
"""

from __future__ import annotations

import re
import logging
from typing import Any
from .lab_parser import ParsedReportIR

log = logging.getLogger(__name__)


def get_test_aliases(test_name: str) -> list[str]:
    aliases = [test_name]
    if "(" in test_name and ")" in test_name:
        inside = re.search(r"\((.*?)\)", test_name)
        if inside:
            aliases.append(inside.group(1).strip())
        outside = re.sub(r"\(.*?\)", "", test_name).strip()
        if outside:
            aliases.append(outside)
    if " - " in test_name:
        parts = [part.strip() for part in test_name.split(" - ")]
        for p in parts:
            if p.lower() not in ("cholesterol", "protein", "calcium", "total"):
                aliases.append(p)
    return [a for a in set(aliases) if len(a) >= 3]


def remove_sentences_matching(text: str, pattern: str) -> str:
    """Remove individual sentences that match the regex pattern."""
    if not text.strip():
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    cleaned = [s.strip() for s in sentences if s.strip() and not re.search(pattern, s)]
    return " ".join(cleaned).strip()


# A report stating its own clean result — a radiologist's "no abnormality
# detected", a normal study. When the document says this itself, the summary
# repeating it is reporting, not inventing.
_DOCUMENT_STATES_NORMAL = re.compile(
    r"(?i)\b(no significant abnormalit|no abnormality detected|within normal limits"
    r"|normal study|essentially normal|unremarkable|no evidence of)\b"
)

# A SWEEPING claim that everything is fine. Deliberately targets the universal
# quantifier ("all ... within normal", "no abnormal findings") and not specific
# statements like "Thyroid profile is within normal limits", which are useful
# and true even on a report that has other abnormalities — those are checked
# per-test further down instead.
#
# Every gap is bounded; an unbounded one here would reintroduce the
# catastrophic backtracking that once hung this service on large reports.
_SWEEPING_NORMAL = (
    r"(?i)("
    r"\ball\b[^.\n]{0,120}?\b(?:within|inside)\b[^.\n]{0,40}?\b(?:normal|reference)\b"
    r"|\ball\b[^.\n]{0,120}?\bare\s+normal\b"
    r"|\bno\s+abnormal\s+(?:findings?|results?|values?|parameters?|patterns?)\b"
    r"|\b(?:does|do|did)\s+not\s+(?:reveal|indicate|show|demonstrate)\s+any\s+abnormal"
    r"|\bno\s+significant\s+abnormalit"
    r"|\bwithin\s+normal\s+limits\s+for\s+all\b"
    r"|\ball\s+(?:laboratory\s+|tested\s+)?(?:results?|parameters?)\b[^.\n]{0,60}?\bnormal\b"
    r"|\bno\s+clinically\s+significant\b[^.\n]{0,40}?\bfindings?\b"
    r")"
)


def validate_and_sanitize_summary(
    raw_summary: dict[str, Any],
    ir: ParsedReportIR,
    raw_text: str = "",
) -> dict[str, Any]:
    """Sanitize summary object against authoritative structured IR.

    `raw_text` is the document itself, needed to tell a fabricated all-clear
    from a genuine one: a radiology report that says "no significant
    abnormality detected" may be summarised as such, while the same sentence
    on a report where nothing was read and nothing says so is invention.
    """
    sanitized = dict(raw_summary)

    # 0. NOTHING VERIFIED = NO REASSURANCE (but still a summary).
    #
    # No parseable lab values does NOT mean the report is unreadable. A
    # radiology report, an ECG narrative or a discharge summary has no numeric
    # rows at all, and OCR of a photographed table often yields none either.
    # Those documents still deserve a summary, so this must not refuse outright
    # — an earlier version did, and turned every such report into "could not be
    # read".
    #
    # What stays forbidden is the one output that is dangerous without evidence:
    # a clean bill of health. Whether the file was noise or simply had no
    # numbers, nothing here has been range-checked, so no "all normal" claim may
    # survive. Genuinely unreadable files are caught earlier, on the text
    # itself, before this runs.
    nothing_verified = not ir.all_results and not ir.ecg_findings
    if nothing_verified:
        log.info("No lab values parsed — summarising, but blocking any 'all normal' claim.")

    # 1. Authoritative Abnormal Values List
    authoritative_abnormals = [r.to_dict() for r in ir.abnormal_results]
    for ecg in ir.ecg_findings:
        authoritative_abnormals.append({
            "label": "ECG Finding",
            "value": ecg,
            "reference": "Normal ECG",
            "direction": "abnormal",
            "status": "ABNORMAL",
            "category": "Cardiology / ECG",
        })
    for rad in getattr(ir, "radiology_findings", []):
        authoritative_abnormals.append({
            "label": "USG / Radiology Finding",
            "value": rad,
            "reference": "Normal Ultrasound",
            "direction": "abnormal",
            "status": "ABNORMAL",
            "category": "Radiology / Ultrasound",
        })
    for pft in getattr(ir, "pft_findings", []):
        authoritative_abnormals.append({
            "label": "PFT / Spirometry Finding",
            "value": pft,
            "reference": "Normal Spirometry",
            "direction": "abnormal",
            "status": "ABNORMAL",
            "category": "Pulmonology / PFT",
        })
    sanitized["abnormal_values"] = authoritative_abnormals

    # ── SPECIAL CASE: SINGLE-TEST REPORT (1 or 2 tests) ──
    # If the report only contains 1 test and no diagnostic scans
    if len(ir.all_results) == 1 and not ir.ecg_findings and not getattr(ir, "radiology_findings", []) and not getattr(ir, "pft_findings", []):
        r = ir.all_results[0]
        patient_str = f"For patient {ir.patient_name}, " if ir.patient_name else ""
        if r.status in ("HIGH", "LOW", "ABNORMAL"):
            status_desc = "markedly elevated" if r.status == "HIGH" else "low" if r.status == "LOW" else "abnormal"
            sanitized["summary"] = (
                f"{patient_str}{r.test_name} is {status_desc} at {r.value} {r.unit} "
                f"(reference range {r.reference_raw}). Clinical correlation and appropriate follow-up are recommended."
            ).strip()
            sanitized["key_findings"] = [f"{r.test_name}: {r.value} {r.unit} (reference {r.reference_raw}) — {r.status}"]
        else:
            sanitized["summary"] = (
                f"{patient_str}{r.test_name} is within the normal reference range at {r.value} {r.unit} "
                f"(reference range {r.reference_raw})."
            ).strip()
            sanitized["key_findings"] = [f"{r.test_name}: {r.value} {r.unit} (reference {r.reference_raw}) — Normal"]
        sanitized["report_type"] = f"{r.category} ({r.test_name})"
        return sanitized

    # 2. Extract Narrative and Findings
    narrative = str(sanitized.get("summary") or "")
    key_findings = [str(f) for f in sanitized.get("key_findings") or []]

    # 3. Grounding Enforcement: NO EVIDENCE = DO NOT MENTION
    all_test_names_lower = {r.test_name.lower() for r in ir.all_results}
    categories_present = {r.category for r in ir.all_results}

    # A. ECG
    if not ir.ecg_findings:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(ecg|electrocardiogram|axis deviation|myocardial infarction|sinus rhythm)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(ecg|electrocardiogram|axis deviation|myocardial infarction|sinus rhythm)\b", f)]

    # B. Cardiovascular / Lipids
    if "Lipid & Cardiovascular Profile" not in categories_present:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(cardiovascular|lipid profile|atherogenic|dyslipidemia|cholesterol|triglyceride|lipoprotein|homocysteine)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(cardiovascular|lipid profile|atherogenic|dyslipidemia|cholesterol|triglyceride|lipoprotein|homocysteine)\b", f)]

    # C. Electrolytes
    if not any(t in all_test_names_lower for t in ["sodium", "potassium", "chloride", "electrolyte"]):
        narrative = remove_sentences_matching(narrative, r"(?i)\belectrolyte\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\belectrolyte\b", f)]

    # D. Liver / Hepatic
    has_liver = ("Liver Function" in categories_present) or any("liver" in r.lower() or "hepatomegaly" in r.lower() for r in getattr(ir, "radiology_findings", []))
    if not has_liver:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(liver|hepatic|ast|alt|bilirubin|transaminase|sgot|sgpt)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(liver|hepatic|ast|alt|bilirubin|transaminase|sgot|sgpt)\b", f)]

    # E. Kidney / Renal
    if "Kidney Function" not in categories_present:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(kidney|renal|creatinine|bun|egfr|urea)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(kidney|renal|creatinine|bun|egfr|urea)\b", f)]

    # F. Vitamins & Minerals
    if "Vitamins & Minerals" not in categories_present:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(vitamin|nutritional|mineral|calcium|vitamin d)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(vitamin|nutritional|mineral|calcium|vitamin d)\b", f)]

    # G. Thyroid
    if "Thyroid Profile" not in categories_present:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(thyroid|tsh|t3|t4)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(thyroid|tsh|t3|t4)\b", f)]

    # H. Urine
    if "Urine Routine & Microscopy" not in categories_present:
        narrative = remove_sentences_matching(narrative, r"(?i)\b(urine|urinary|pus cells)\b")
        key_findings = [f for f in key_findings if not re.search(r"(?i)\b(urine|urinary|pus cells)\b", f)]

    # 4. Global "All Normal" False Claim Detection
    #    Fires when something abnormal WAS found (the claim contradicts it), and
    #    when nothing was verified AND the document never says so itself (the
    #    claim has no basis). A radiology report that states its own clean
    #    result is left alone — repeating that is reporting, not inventing.
    document_states_normal = bool(_DOCUMENT_STATES_NORMAL.search(raw_text))
    if (
        ir.abnormal_results
        or ir.ecg_findings
        or (nothing_verified and not document_states_normal)
    ):
        before = narrative
        narrative = remove_sentences_matching(narrative, _SWEEPING_NORMAL)
        key_findings = [f for f in key_findings if not re.search(_SWEEPING_NORMAL, f)]
        if narrative != before:
            log.warning(
                "Removed a sweeping 'all normal' claim contradicted by %d abnormal result(s).",
                len(ir.abnormal_results),
            )

    # 5. Check for False Normal Claims on Truly Abnormal Tests
    for r in ir.abnormal_results:
        for alias in get_test_aliases(r.test_name):
            test_pattern = re.escape(alias)
            false_normal_patterns = [
                rf"(?i)\b{test_pattern}\b[^\.\n]*?\b(?:within\s+(?:the\s+)?(?:reference|normal)\s+range|is\s+normal|in\s+normal\s+range)\b",
                rf"(?i)\b(?:normal|unremarkable)\b[^\.\n]*?\b{test_pattern}\b",
            ]
            for pat in false_normal_patterns:
                if re.search(pat, narrative):
                    log.warning("Detected LLM contradiction for %s (alias %s, status=%s). Correcting.", r.test_name, alias, r.status)
                    narrative = re.sub(pat, f"{alias} is {r.status.lower()} ({r.value} {r.unit})", narrative)

    # 6. Check for False Abnormal Claims on Truly Normal Tests
    for r in ir.normal_results:
        for alias in get_test_aliases(r.test_name):
            test_pattern = re.escape(alias)
            false_elevated_patterns = [
                rf"(?i)\belevated\s+{test_pattern}\b",
                rf"(?i)\b{test_pattern}\b[^\.\n]*?\b(?:is\s+elevated|increased|raised|indicates\s+damage)\b",
            ]
            for pat in false_elevated_patterns:
                if re.search(pat, narrative):
                    log.warning("Detected LLM false alarm for normal test %s (alias %s). Correcting.", r.test_name, alias)
                    narrative = re.sub(pat, f"{alias} is within normal limits ({r.value} {r.unit})", narrative)

    # 7. Fallback if narrative was emptied or degraded by hallucinations
    if len(narrative.strip()) < 25:
        abn_summaries = [f"{r.test_name} is {r.status.lower()} at {r.value} {r.unit} (reference {r.reference_raw})" for r in ir.abnormal_results]
        if abn_summaries:
            narrative = f"Laboratory findings reveal: {'; '.join(abn_summaries)}. Clinical correlation and follow-up are recommended."
        elif ir.normal_results:
            # Only claim "all normal" when values were actually read and checked.
            narrative = "All tested laboratory parameters are within their reference intervals."
        else:
            narrative = (
                "No laboratory values could be confirmed from this report. "
                "Please review the file directly."
            )

    # 8. High-Yield Findings Synthesis
    if not key_findings:
        key_findings = [f"{r.test_name}: {r.value} {r.unit} — {r.status}" for r in ir.abnormal_results]
        for ecg in ir.ecg_findings:
            key_findings.append(f"ECG Finding: {ecg}")

    sanitized["summary"] = narrative.strip()
    sanitized["key_findings"] = key_findings
    return sanitized
