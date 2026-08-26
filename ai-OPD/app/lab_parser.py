"""Deterministic Clinical Laboratory Report Parser and Intermediate Representation (IR) Engine.

Authoritative reference-range validation:
- Extracts test parameters, numeric/qualitative values, units, and reference intervals.
- Mathematically computes status: LOW, HIGH, NORMAL, ABNORMAL, or UNCERTAIN.
- Assigns clinical organ panel categories.
- Filters out laboratory commentary, educational disclaimers, and table artifacts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Literal, Any


StatusType = Literal["LOW", "HIGH", "NORMAL", "ABNORMAL", "UNCERTAIN"]


@dataclass
class LabResult:
    test_name: str
    value: str
    numeric_value: float | None
    unit: str
    reference_raw: str
    reference_low: float | None
    reference_high: float | None
    status: StatusType
    category: str = "General"

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.test_name,
            "value": f"{self.value} {self.unit}".strip() if self.unit and not self.value.endswith(self.unit) else self.value,
            "reference": self.reference_raw,
            "direction": "low" if self.status == "LOW" else "high" if self.status == "HIGH" else "abnormal" if self.status == "ABNORMAL" else "normal",
            "status": self.status,
            "category": self.category,
        }


@dataclass
class ParsedReportIR:
    patient_name: str = ""
    age: str = ""
    gender: str = ""
    date: str = ""
    report_title: str = "Medical Laboratory Report"
    all_results: list[LabResult] = field(default_factory=list)
    abnormal_results: list[LabResult] = field(default_factory=list)
    normal_results: list[LabResult] = field(default_factory=list)
    ecg_findings: list[str] = field(default_factory=list)
    radiology_findings: list[str] = field(default_factory=list)
    pft_findings: list[str] = field(default_factory=list)

    def grouped_abnormals(self) -> dict[str, list[LabResult]]:
        grouped: dict[str, list[LabResult]] = {}
        for r in self.abnormal_results:
            grouped.setdefault(r.category, []).append(r)
        return grouped

    def grouped_normals(self) -> dict[str, list[LabResult]]:
        grouped: dict[str, list[LabResult]] = {}
        for r in self.normal_results:
            grouped.setdefault(r.category, []).append(r)
        return grouped


# Standard clinical category classification rules
CATEGORY_RULES: list[tuple[list[str], str]] = [
    (
        ["hemoglobin", "haemoglobin", "rbc", "hct", "pcv", "mcv", "mch", "mchc", "rdw", "leucocyte", "wbc", "neutrophil", "lymphocyte", "monocyte", "eosinophil", "basophil", "platelet", "mpv", "pdw"],
        "Complete Blood Count",
    ),
    (
        ["iron", "tibc", "uibc", "transferrin", "ferritin"],
        "Iron Studies",
    ),
    (
        ["esr", "sedimentation", "c-reactive", "crp", "hs-crp"],
        "Inflammatory Markers",
    ),
    (
        ["hba1c", "glycosylated", "glucose", "fbs", "ppbs", "sugar", "insulin"],
        "Diabetes Profile",
    ),
    (
        ["cholesterol", "triglyceride", "hdl", "ldl", "vldl", "non hdl", "non-hdl", "lipoprotein", "homocysteine", "apolipoprotein", "apo a", "apo b"],
        "Lipid & Cardiovascular Profile",
    ),
    (
        ["bilirubin", "sgot", "ast", "sgpt", "alt", "alkaline phosphatase", "alp", "ggt", "gamma glutamyl", "protein, total", "total protein", "albumin", "globulin", "a/g ratio"],
        "Liver Function",
    ),
    (
        ["urea", "bun", "blood urea nitrogen", "creatinine", "uric acid", "egfr", "gfr", "sodium", "potassium", "chloride", "microalbumin"],
        "Kidney Function",
    ),
    (
        ["vitamin d", "calcium", "phosphorus", "vitamin b12", "vitamin b9", "folate", "folic acid"],
        "Vitamins & Minerals",
    ),
    (
        ["t3", "t4", "tsh", "thyroid"],
        "Thyroid Profile",
    ),
    (
        ["ige", "immunoglobulin e", "rheumatoid factor", "rf"],
        "Immunology & Allergy",
    ),
    (
        ["lipase", "amylase"],
        "Pancreas Profile",
    ),
    (
        ["urine", "pus cells", "epithelial", "casts", "crystals", "specific gravity"],
        "Urine Routine & Microscopy",
    ),
]


def classify_category(test_name: str) -> str:
    name_lower = test_name.lower()
    for keywords, cat in CATEGORY_RULES:
        if any(kw in name_lower for kw in keywords):
            return cat
    return "General Pathology"


def clean_test_name(raw_name: str) -> str:
    """Normalize test names and eliminate table artifacts."""
    name = raw_name.strip()
    name = re.sub(r"^[0-9\:\.\-\s]+", "", name)  # Remove leading numbers/colons
    name = re.sub(r"\s+", " ", name)
    name = name.strip()

    # Specific name corrections
    replacements = [
        (r"(?i)^ldl\s*:\s*hdl(?:\s*cholesterol)?", "LDL : HDL Cholesterol"),
        (r"(?i)^cholesterol\s*:\s*hdl(?:\s*cholesterol)?", "Cholesterol : HDL Cholesterol"),
        (r"(?i)^apolipoprotein\s*[-–]?\s*a1", "Apolipoprotein - A1"),
        (r"(?i)^apolipoprotein\s*[-–]?\s*b", "Apolipoprotein - B"),
        (r"(?i)^apolipoprotein\s*b\/a1\s*ratio", "Apolipoprotein B/A1 Ratio"),
        (r"(?i)^sgot\s*\(aspartate aminotransferase\)", "SGOT (AST)"),
        (r"(?i)^sgpt\s*\(alanine transaminase\)", "SGPT (ALT)"),
        (r"(?i)^erythrocyte sedimentation rate", "Erythrocyte Sedimentation Rate (ESR)"),
        (r"(?i)^glycosylated hemoglobin\s*\(hba1c\)", "Glycosylated Hemoglobin (HbA1c)"),
        (r"(?i)^c-reactive protein\s*\(quantitative\)", "C-Reactive Protein (Quantitative)"),
        (r"(?i)^high sensitivity crp", "High sensitivity CRP (hs-CRP)"),
        (r"(?i)^vitamin d\s*\(25-oh\)", "Vitamin D (25-OH)"),
        (r"(?i)^immunoglobulin e\s*\(ige\)\s*total", "Immunoglobulin E (IgE) Total"),
        (r"(?i)^e\s*gfr|glomerular filtration rate", "eGFR"),
        (r"(?i)^bilirubin\s*[-–]?\s*total", "Bilirubin - Total"),
        (r"(?i)^bilirubin\s*[-–]?\s*direct", "Bilirubin - Direct"),
        (r"(?i)^bilirubin\s*[-–]?\s*indirect", "Bilirubin - Indirect"),
        (r"(?i)^glucose[\,\s\-]+fasting[\,\s\-]+plasma", "Glucose, Fasting, Plasma"),
        (r"(?i)^glucose\s*[-–]?\s*fasting", "Glucose - Fasting"),
        (r"(?i)^fasting\s*blood\s*sugar", "Fasting Blood Sugar"),
    ]
    for pattern, repl in replacements:
        if re.search(pattern, name):
            return repl
    return name


# Lines of a "Test: X / Result: Y / Reference: Z" block, matched one line at a
# time by the scanner below.
_KV_NAME = re.compile(r"(?i)(?:test|investigation|parameter)\s*[:\-]\s*(.+?)\s*$")
_KV_VALUE = re.compile(
    r"(?i)(?:result|observed value|value)\s*[:\-]\s*"
    r"([<>]?\s*\d+(?:\.\d+)?)\s*([A-Za-z0-9\^/%:.\-]+)?\s*$"
)
_KV_REFERENCE = re.compile(
    r"(?i)(?:reference|bio\.?\s*ref\.?\s*interval|normal range)\s*[:\-]\s*"
    r"(?:(?:<=|<|>=|>)\s*)?(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)"
)

# How many lines after "Test:" the Result and Reference may appear.
_KV_WINDOW = 6


def _iter_key_value_blocks(text: str):
    """Yield (name, value, unit, ref_low, ref_high) for each Test/Result/Reference block.

    Scans line by line inside a short window rather than matching one regex
    across the whole document. The previous version used two unbounded `.*?`
    under re.DOTALL, so a report carrying "Test:"/"Result:" but no
    "Reference: low-high" — common, plenty of labs omit intervals — made the
    engine backtrack over the entire text from every start position. Measured:
    767 chars 1.2s, 1.5k chars 9.7s, 3k chars never finished. A multi-page OCR'd
    report is tens of thousands of characters, which pegged a core and hung the
    whole single-threaded sidecar until it was killed. This form is linear.
    """
    lines = text.splitlines()
    for i, line in enumerate(lines):
        name_match = _KV_NAME.match(line.strip())
        if not name_match:
            continue

        window = lines[i + 1 : i + 1 + _KV_WINDOW]

        value_match = None
        value_at = -1
        for j, candidate in enumerate(window):
            value_match = _KV_VALUE.search(candidate.strip())
            if value_match:
                value_at = j
                break
        if not value_match:
            continue

        reference_match = None
        for candidate in window[value_at + 1 :]:
            reference_match = _KV_REFERENCE.search(candidate.strip())
            if reference_match:
                break
        if not reference_match:
            continue

        yield (
            name_match.group(1),
            value_match.group(1).replace("<", "").replace(">", "").strip(),
            (value_match.group(2) or "").strip(),
            reference_match.group(1),
            reference_match.group(2),
        )


def parse_lab_report_text(text: str) -> ParsedReportIR:
    """Deterministic parser extracting test records and evaluating clinical reference ranges."""
    ir = ParsedReportIR()
    seen_tests: set[str] = set()

    # 1. Extract Patient Metadata
    name_m = re.search(r"(?i)(?:prepared for|customer name|patient name)\s*[:\n]\s*(?:Mr\.|Ms\.|Mrs\.|Dr\.)?\s*([A-Za-z\s]+?)(?:\r|\n|$)", text)
    if not name_m:
        name_m = re.search(r"(?i)\bname\s*[:\n]\s*(?:Mr\.|Ms\.|Mrs\.|Dr\.)?\s*([A-Za-z\s]+?)(?:\r|\n|$)", text)
    if name_m:
        pname = name_m.group(1).strip().title()
        # Clean trailing OCR noise words
        pname = re.sub(r"(?i)\s+(?:spree|collected|dwk|self|male|female|age|yrs|years|mr|mrs|dr)$", "", pname).strip()
        ir.patient_name = pname

    age_gender_m = re.search(r"(?i)(?:gender\/age|age\/gender|age\/sex|sex\/age|basic info)\s*[:\n]\s*([A-Za-z0-9\s\/\,]+?)(?:\r|\n|$)", text)
    if age_gender_m:
        raw_ag = age_gender_m.group(1).strip()
        if "female" in raw_ag.lower():
            ir.gender = "Female"
        elif "male" in raw_ag.lower():
            ir.gender = "Male"
        num_m = re.search(r"(\d+)\s*(?:yrs|years|y)?", raw_ag, re.IGNORECASE)
        if num_m:
            ir.age = f"{num_m.group(1)} Yrs"
    else:
        age_m = re.search(r"(?i)(\d+)\s*(?:yrs|years|y)\s*(?:old)?\s*\/?\s*(male|female)", text)
        if age_m:
            ir.age = f"{age_m.group(1)} Yrs"
            ir.gender = age_m.group(2).capitalize()

    date_m = re.search(r"(?i)(?:sample collection date|collection date|date of collection|report date|date)\s*[:\n]\s*(\d{1,2}[\/\-\.][A-Za-z0-9]+[\/\-\.]\d{2,4})", text)
    if date_m:
        ir.date = date_m.group(1).strip()

    # 2. Extract ECG findings if present
    for ecg_pat in [
        r"(?i)(left axis deviation[^\.\n]*)",
        r"(?i)(possible old inferior mi[^\.\n]*)",
        r"(?i)(inferior myocardial infarction[^\.\n]*)",
        r"(?i)(sinus bradycardia[^\.\n]*)",
        r"(?i)(sinus tachycardia[^\.\n]*)",
        r"(?i)(atrial fibrillation[^\.\n]*)",
        r"(?i)(st[-\s]t segment[^\.\n]*)",
        r"(?i)(right bundle branch block[^\.\n]*)",
        r"(?i)(left bundle branch block[^\.\n]*)",
        r"(?i)(qt\/qtc\s*[^\n]*)",
        r"(?i)(p\/qrs\/t axis[^\n]*)",
    ]:
        for match in re.finditer(ecg_pat, text):
            finding = match.group(1).strip()
            if finding and finding not in ir.ecg_findings:
                ir.ecg_findings.append(finding)

    if not ir.ecg_findings and re.search(r"(?i)\b(?:section\s*:\s*ecg|electrocardiography|12[-\s]lead ecg)\b", text):
        hr_m = re.search(r"(?i)\bhr\b[^\d\n]*(\d+)", text)
        hr_str = f" (HR: {hr_m.group(1)} bpm)" if hr_m else ""
        ir.ecg_findings.append(f"12-Lead ECG recorded{hr_str}")

    # 2b. Extract Radiology / Ultrasound Findings
    for rad_pat in [
        r"(?i)(mild hepatomegaly with grade [iIvV\/]+ fatty changes[^\.\n]*)",
        r"(?i)(mild hepatomegaly[^\.\n]*)",
        r"(?i)(prostatomegaly[^\.\n]*)",
        r"(?i)(fatty changes in liver[^\.\n]*)",
        r"(?i)(cholelithiasis[^\.\n]*)",
        r"(?i)(nephrolithiasis[^\.\n]*)",
        r"(?i)(hydronephrosis[^\.\n]*)",
        r"(?i)(liver is mildly enlarged[^\.\n]*)",
        r"(?i)(prostate is enlarged[^\.\n]*)",
    ]:
        for match in re.finditer(rad_pat, text):
            start_pos = max(0, match.start() - 30)
            prefix = text[start_pos:match.start()].lower()
            # Ignore negated findings like "no hydronephrosis", "no focal lesion", "no evidence of"
            if re.search(r"\b(no|without|no evidence of|not detected)\s*$", prefix):
                continue
            finding = match.group(1).strip()
            finding = re.sub(r"\s+", " ", finding).strip()
            if len(finding) >= 6 and not any(finding.lower() == f.lower() for f in ir.radiology_findings):
                ir.radiology_findings.append(finding)

    # 2c. Extract Pulmonary Function Test (PFT) / Spirometry Findings
    for pft_pat in [
        r"(?i)(obstructive abnormality\s*:\s*[^\.\n]*)",
        r"(?i)(restrictive anomaly\s*:\s*[^\.\n]*)",
    ]:
        for match in re.finditer(pft_pat, text):
            finding = match.group(1).strip()
            finding = re.sub(r"\s+", " ", finding).strip()
            if len(finding) >= 6 and not any(finding.lower() == f.lower() for f in ir.pft_findings):
                ir.pft_findings.append(finding)

    # 2b. Multi-Line Key-Value Block Parser (e.g. Test: X \n Result: Y \n Reference: Z)
    for raw_name, val_str, unit, low_str, high_str in _iter_key_value_blocks(text):
        test_name = clean_test_name(raw_name)
        if test_name and len(test_name) >= 2 and test_name.lower() not in seen_tests:
            try:
                val = float(val_str)
                low_ref = float(low_str)
                high_ref = float(high_str)
                status: StatusType = "LOW" if val < low_ref else "HIGH" if val > high_ref else "NORMAL"
                category = classify_category(test_name)
                result = LabResult(
                    test_name=test_name,
                    value=val_str,
                    numeric_value=val,
                    unit=unit,
                    reference_raw=f"{low_ref} - {high_ref} {unit}".strip(),
                    reference_low=low_ref,
                    reference_high=high_ref,
                    status=status,
                    category=category,
                )
                seen_tests.add(test_name.lower())
                ir.all_results.append(result)
                if status in ("LOW", "HIGH"):
                    ir.abnormal_results.append(result)
                else:
                    ir.normal_results.append(result)
            except (ValueError, TypeError):
                pass

    # 3. Parse Line by Line with Strict Multi-Pattern Range Evaluator
    lines = text.splitlines()
    for raw_line in lines:
        line = raw_line.strip()
        if not line or "Page " in line or "TATA 1MG" in line or "Comment:" in line:
            continue

        # Skip headers / footers / disclaimers
        if re.search(r"\b(disclaimer|method|principle|specimen|customer|referred by|barcode|order id|lab visit)\b", line, re.IGNORECASE):
            continue

        # Ignore lines without letters
        if not re.search(r"[A-Za-z]{2,}", line):
            continue

        # ── Pattern A: Standard Numeric Range (TestName Value [Unit] Low - High [Unit]) ──
        m_range = re.search(
            r"^([A-Za-z0-9\s\(\)\-\,\/\+\:\.]+?)\s+([<>]?\s*\d+(?:\.\d+)?)\s*([A-Za-z0-9\^\/\%\:\.\-\sµμ\*]+?)?\s+(?:(?:<=|<|>=|>)\s*)?(\d+(?:\.\d+)?)\s*[-–—to]+\s*(\d+(?:\.\d+)?)",
            line,
            re.IGNORECASE,
        )
        if m_range:
            raw_name = m_range.group(1).strip()
            val_str = m_range.group(2).strip().replace("<", "").replace(">", "").strip()
            unit = (m_range.group(3) or "").strip()
            low_str = m_range.group(4).strip()
            high_str = m_range.group(5).strip()

            test_name = clean_test_name(raw_name)
            if not test_name or len(test_name) < 2 or test_name.lower() in seen_tests:
                continue

            try:
                val = float(val_str)
                low_ref = float(low_str)
                high_ref = float(high_str)

                # Authoritative Range Evaluation
                if val < low_ref:
                    status: StatusType = "LOW"
                elif val > high_ref:
                    status = "HIGH"
                else:
                    status = "NORMAL"

                category = classify_category(test_name)
                result = LabResult(
                    test_name=test_name,
                    value=val_str,
                    numeric_value=val,
                    unit=unit,
                    reference_raw=f"{low_ref} - {high_ref} {unit}".strip(),
                    reference_low=low_ref,
                    reference_high=high_ref,
                    status=status,
                    category=category,
                )

                seen_tests.add(test_name.lower())
                ir.all_results.append(result)
                if status in ("LOW", "HIGH"):
                    ir.abnormal_results.append(result)
                else:
                    ir.normal_results.append(result)
                continue
            except (ValueError, TypeError):
                pass

        # ── Pattern B: Single Upper Bound (TestName Value [Unit] <= Threshold) ──
        m_upper = re.search(
            r"^([A-Za-z0-9\s\(\)\-\,\/\+\:\.]+?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z0-9\^\/\%\:\.\-\sµμ\*]+?)?\s+(?:<=|<|less than)\s*(\d+(?:\.\d+)?)",
            line,
            re.IGNORECASE,
        )
        if m_upper:
            raw_name = m_upper.group(1).strip()
            val_str = m_upper.group(2).strip()
            unit = (m_upper.group(3) or "").strip()
            thresh_str = m_upper.group(4).strip()

            test_name = clean_test_name(raw_name)
            if not test_name or len(test_name) < 2 or test_name.lower() in seen_tests:
                continue

            try:
                val = float(val_str)
                thresh = float(thresh_str)
                status = "HIGH" if val > thresh else "NORMAL"
                category = classify_category(test_name)

                result = LabResult(
                    test_name=test_name,
                    value=val_str,
                    numeric_value=val,
                    unit=unit,
                    reference_raw=f"<= {thresh} {unit}".strip(),
                    reference_low=None,
                    reference_high=thresh,
                    status=status,
                    category=category,
                )

                seen_tests.add(test_name.lower())
                ir.all_results.append(result)
                if status == "HIGH":
                    ir.abnormal_results.append(result)
                else:
                    ir.normal_results.append(result)
                continue
            except (ValueError, TypeError):
                pass

        # ── Pattern C: Single Lower Bound (TestName Value [Unit] >= Threshold) ──
        m_lower = re.search(
            r"^([A-Za-z0-9\s\(\)\-\,\/\+\:\.]+?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z0-9\^\/\%\:\.\-\sµμ\*]+?)?\s+(?:>=|>|more than)\s*(\d+(?:\.\d+)?)",
            line,
            re.IGNORECASE,
        )
        if m_lower:
            raw_name = m_lower.group(1).strip()
            val_str = m_lower.group(2).strip()
            unit = (m_lower.group(3) or "").strip()
            thresh_str = m_lower.group(4).strip()

            test_name = clean_test_name(raw_name)
            if not test_name or len(test_name) < 2 or test_name.lower() in seen_tests:
                continue

            try:
                val = float(val_str)
                thresh = float(thresh_str)
                status = "LOW" if val < thresh else "NORMAL"
                category = classify_category(test_name)

                result = LabResult(
                    test_name=test_name,
                    value=val_str,
                    numeric_value=val,
                    unit=unit,
                    reference_raw=f">= {thresh} {unit}".strip(),
                    reference_low=thresh,
                    reference_high=None,
                    status=status,
                    category=category,
                )

                seen_tests.add(test_name.lower())
                ir.all_results.append(result)
                if status == "LOW":
                    ir.abnormal_results.append(result)
                else:
                    ir.normal_results.append(result)
                continue
            except (ValueError, TypeError):
                pass

        # ── Pattern D: Qualitative Tests (e.g. Urine Blood 1+ / Negative) ──
        # e.g., "Blood 1+ Negative"
        # e.g., "Glucose Negative Negative"
        m_qual = re.search(
            r"^([A-Za-z0-9\s\(\)\-\,\/\+]+?)\s+(1\+|2\+|3\+|4\+|Positive|Negative|Trace|Present|Absent|Nil)\s+(Negative|Positive|Nil|Absent|Normal)",
            line,
            re.IGNORECASE,
        )
        if m_qual:
            raw_name = m_qual.group(1).strip()
            val_str = m_qual.group(2).strip()
            ref_str = m_qual.group(3).strip()

            test_name = clean_test_name(raw_name)
            if not test_name or len(test_name) < 2 or test_name.lower() in seen_tests:
                continue

            is_norm = (val_str.lower() in ("negative", "nil", "absent", "normal")) and (ref_str.lower() in ("negative", "nil", "absent", "normal"))
            status = "NORMAL" if is_norm else "ABNORMAL"
            category = classify_category(f"Urine {test_name}")

            result = LabResult(
                test_name=f"Urine {test_name}" if "urine" not in test_name.lower() else test_name,
                value=val_str,
                numeric_value=None,
                unit="",
                reference_raw=ref_str,
                reference_low=None,
                reference_high=None,
                status=status,
                category=category,
            )

            seen_tests.add(test_name.lower())
            ir.all_results.append(result)
            if status == "ABNORMAL":
                ir.abnormal_results.append(result)
            else:
                ir.normal_results.append(result)
            continue

    return ir
