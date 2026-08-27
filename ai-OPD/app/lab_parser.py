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

# ── Plausibility gate ────────────────────────────────────────
#
# The line patterns below are shaped like "Name Value Unit Low - High", which
# ordinary English prose also fits. A sentence such as
#
#     "...detectable as early as 5 days after fever starts and usually
#      lasts 30 to 90 days..."
#
# parses as a test called "early as", value 5, unit "days after fever starts
# and usually last", range 30-90 — and is then reported to the doctor as a LOW
# result. Everything downstream trusts this parser precisely because it is
# deterministic, so a fabricated result here reaches the summary as fact.
#
# Two cheap signals separate a real row from a sentence: real units are short
# (mg/dL, %, U/L), and real test names are not prose fragments.

# A unit longer than this is a sentence fragment, not a unit.
_MAX_UNIT_WORDS = 3
_MAX_UNIT_CHARS = 20

# Words no real test name starts or ends with. A name *containing* one may be
# legitimate ("Total Protein, Serum"), so only the edges are checked.
# "a"/"an" are deliberately absent: a real name may legitimately end in a bare
# letter ("Vitamin A", "Apolipoprotein - A1"), and rejecting those costs far
# more than the prose they would have caught.
_PROSE_EDGE_WORDS = {
    "as", "the", "and", "or", "but", "if", "of", "in", "on", "at",
    "to", "by", "for", "with", "from", "than", "then", "that", "this", "these",
    "is", "are", "was", "were", "be", "been", "has", "have", "had", "not",
    "usually", "early", "late", "after", "before", "during", "within", "about",
    "approximately", "up", "over", "under", "more", "less", "least", "most",
    "may", "can", "should", "would", "such", "very", "also", "however",
}


def is_plausible_test(name: str, unit: str | None = None) -> bool:
    """Whether a parsed row looks like a lab result rather than a sentence."""
    cleaned = (name or "").strip()
    if len(cleaned) < 2:
        return False

    # A unit that runs on is the strongest tell that prose was matched.
    u = (unit or "").strip()
    if u:
        if len(u) > _MAX_UNIT_CHARS or len(u.split()) > _MAX_UNIT_WORDS:
            return False
        # Every real unit is either "%" or contains a letter (mg/dL, IU/mL,
        # 10^3/µL, Ratio). A purely numeric "unit" like "-2.5" or "-15" means
        # the pattern chewed through a reference table — "1st trimester 0.1
        # -2.5" and "Extreme-risk group- category C 10 -15" both land here.
        if u != "%" and not re.search(r"[A-Za-zµμ]", u):
            return False

    # Alphanumeric tokens, so "A1" and "HbA1c" survive as single units.
    tokens = re.findall(r"[A-Za-z0-9]+", cleaned.lower())
    if not tokens:
        return False

    def is_prose_word(tok: str) -> bool:
        # Only a purely alphabetic token of two or more letters can be a prose
        # word — "A1" is a test suffix, "as" is English.
        return tok.isalpha() and len(tok) > 1 and tok in _PROSE_EDGE_WORDS

    # "early as", "usually last" — prose fragments, not test names.
    if is_prose_word(tokens[0]) or is_prose_word(tokens[-1]):
        return False

    words = tokens

    # A test name is a label, not a clause. Real ones are short, even the
    # verbose ones ("Glucose, Fasting, Plasma" is four words).
    if len(words) > 8:
        return False

    return True


# ── Reference-first column layouts ───────────────────────────
#
# Hospital "investigation summary" sheets print the reference interval BEFORE
# the unit and the result, and carry one result column per visit — the current
# one first, earlier ones after it:
#
#   GLYCATED Hb (HbA1c)   < 5.70        %        6.60   8.60
#   TSH                   0.27 - 4.20   uIU/mL   2.800
#
# Patterns A-C all read a row left to right as name, value, unit, reference, so
# they match nothing here and a whole report parses as zero results — which the
# summariser's guard then reads as "no evidence for any of these panels". These
# two run only after A-D have failed, so no layout already handled reaches them.
_UNIT_TOKEN = r"[A-Za-z%µμ][A-Za-z0-9µμ/%^.\-]{0,14}"
# A leading asterisk marks a calculated parameter ("*LDL CHOLESTEROL").
_NAME_HEAD = r"\*?\s*([A-Za-z][A-Za-z0-9\s\(\)\-\,\/\+\:\.]*?)"
# Trailing columns are previous visits; only the first result is current. The
# end anchor is what keeps these off prose — a sentence rarely stops on a bare
# number.
_PRIOR_COLUMNS = r"(?:\s+\d+(?:\.\d+)?)*\s*$"

_REF_FIRST_BOUND = re.compile(
    rf"^{_NAME_HEAD}\s*(<=|<|>=|>)\s*(\d+(?:\.\d+)?)\s+({_UNIT_TOKEN})\s+(\d+(?:\.\d+)?){_PRIOR_COLUMNS}"
)
_REF_FIRST_RANGE = re.compile(
    rf"^{_NAME_HEAD}\s+(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s+({_UNIT_TOKEN})\s+(\d+(?:\.\d+)?){_PRIOR_COLUMNS}"
)


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


def _is_same_assay_twice(a: LabResult, b: LabResult) -> bool:
    """Whether two rows are one assay the lab printed under both its names.

    Reports do this: "GLYCATED Hb (HbA1c)" and "GLYCOSYLATED Hb (HbA1c)", same
    value, same interval, one below the other. Reporting both makes the
    summariser say it twice.

    Identical value, unit, interval and panel is not enough on its own — a
    differential can list "Monocyte Count 5 % 2-10" and "Eosinophil Count
    5 % 2-10" and those are two real results. So the names must also differ in
    exactly one word, and those two words must share a prefix: glycated and
    glycosylated do, monocyte and eosinophil do not.
    """
    if (a.value, a.unit, a.reference_raw, a.category) != (b.value, b.unit, b.reference_raw, b.category):
        return False

    a_tokens = re.findall(r"[A-Za-z0-9]+", a.test_name.lower())
    b_tokens = re.findall(r"[A-Za-z0-9]+", b.test_name.lower())
    if len(a_tokens) != len(b_tokens):
        return False

    differing = [(x, y) for x, y in zip(a_tokens, b_tokens) if x != y]
    if len(differing) != 1:
        return False

    x, y = differing[0]
    shared = 0
    for cx, cy in zip(x, y):
        if cx != cy:
            break
        shared += 1
    return shared >= 4


def _drop_duplicate_assays(ir: ParsedReportIR) -> None:
    """Keep the first spelling of any assay recorded twice."""
    kept: list[LabResult] = []
    dropped: set[int] = set()
    for r in ir.all_results:
        if any(_is_same_assay_twice(r, k) for k in kept):
            dropped.add(id(r))
            continue
        kept.append(r)

    if not dropped:
        return
    ir.all_results = kept
    ir.abnormal_results = [r for r in ir.abnormal_results if id(r) not in dropped]
    ir.normal_results = [r for r in ir.normal_results if id(r) not in dropped]


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

    # Hospital summary sheets label these fields one per line and run a second
    # field on the same line ("Age : 62 Yrs   Episode No. : OP16484377"), which
    # the combined patterns above cannot reach. Each fallback only fills a field
    # still empty, so no layout that already parses is affected.
    if not ir.patient_name:
        name_m = re.search(
            r"(?i)\bname\s*[:\n]\s*(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s+([A-Za-z][A-Za-z\s]+?)"
            r"(?:\s+(?:registration|reg\.?\s*no|episode|uhid|ip\s*no|op\s*no|patient\s*id)\b|\r|\n|$)",
            text,
        )
        if name_m:
            ir.patient_name = name_m.group(1).strip().title()

    if not ir.age:
        age_only_m = re.search(r"(?i)^\s*age\s*[:\-]\s*(\d+)\s*(?:yrs?|years?|y)\b", text, re.MULTILINE)
        if age_only_m:
            ir.age = f"{age_only_m.group(1)} Yrs"

    if not ir.gender:
        gender_only_m = re.search(r"(?i)^\s*(?:gender|sex)\s*[:\-]\s*(male|female)\b", text, re.MULTILINE)
        if gender_only_m:
            ir.gender = gender_only_m.group(1).capitalize()

    if not ir.date:
        date_alt_m = re.search(
            r"(?i)(?:date of admission|date of registration|date of reporting|reported on|collected on)"
            r"\s*[:\-]?\s*(\d{1,2}[\/\-\.][A-Za-z0-9]+[\/\-\.]\d{2,4})",
            text,
        )
        if date_alt_m:
            ir.date = date_alt_m.group(1).strip()

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
        if (
            test_name
            and len(test_name) >= 2
            and test_name.lower() not in seen_tests
            and is_plausible_test(test_name, unit)
        ):
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
            # Prose can satisfy this pattern; make sure it is really a lab row.
            if not is_plausible_test(test_name, unit):
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
            # Prose can satisfy this pattern; make sure it is really a lab row.
            if not is_plausible_test(test_name, unit):
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
            # Prose can satisfy this pattern; make sure it is really a lab row.
            if not is_plausible_test(test_name, unit):
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
            # Prose can satisfy this pattern; make sure it is really a lab row.
            if not is_plausible_test(test_name, unit):
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

        # ── Pattern E: Reference First, Bounded (Test  < Ref  Unit  Value …) ──
        m_ref_bound = _REF_FIRST_BOUND.search(line)
        if m_ref_bound:
            raw_name, op, thresh_str, unit, val_str = m_ref_bound.groups()
            unit = unit.strip()
            test_name = clean_test_name(raw_name.strip())
            if (
                test_name
                and len(test_name) >= 2
                and test_name.lower() not in seen_tests
                and is_plausible_test(test_name, unit)
            ):
                try:
                    val = float(val_str)
                    thresh = float(thresh_str)
                    if op.startswith("<"):
                        status = "HIGH" if val > thresh else "NORMAL"
                        low_ref, high_ref = None, thresh
                    else:
                        status = "LOW" if val < thresh else "NORMAL"
                        low_ref, high_ref = thresh, None

                    result = LabResult(
                        test_name=test_name,
                        value=val_str,
                        numeric_value=val,
                        unit=unit,
                        reference_raw=f"{op} {thresh_str} {unit}".strip(),
                        reference_low=low_ref,
                        reference_high=high_ref,
                        status=status,
                        category=classify_category(test_name),
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

        # ── Pattern F: Reference First, Ranged (Test  Low - High  Unit  Value …) ──
        m_ref_range = _REF_FIRST_RANGE.search(line)
        if m_ref_range:
            raw_name, low_str, high_str, unit, val_str = m_ref_range.groups()
            unit = unit.strip()
            test_name = clean_test_name(raw_name.strip())
            if (
                test_name
                and len(test_name) >= 2
                and test_name.lower() not in seen_tests
                and is_plausible_test(test_name, unit)
            ):
                try:
                    val = float(val_str)
                    low_ref = float(low_str)
                    high_ref = float(high_str)
                    status = "LOW" if val < low_ref else "HIGH" if val > high_ref else "NORMAL"

                    result = LabResult(
                        test_name=test_name,
                        value=val_str,
                        numeric_value=val,
                        unit=unit,
                        reference_raw=f"{low_str} - {high_str} {unit}".strip(),
                        reference_low=low_ref,
                        reference_high=high_ref,
                        status=status,
                        category=classify_category(test_name),
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

    _drop_duplicate_assays(ir)
    return ir
