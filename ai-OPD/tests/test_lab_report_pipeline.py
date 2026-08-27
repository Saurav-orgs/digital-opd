"""Comprehensive Regression and Unit Test Suite for Medical Laboratory Report Pipeline.

Validates deterministic mathematical extraction, dynamic patient handling,
multi-disease profiles, single-test reports, and zero-hallucination guardrails.
"""

import pytest
from app.lab_parser import parse_lab_report_text
from app.contradiction_guard import validate_and_sanitize_summary


# ── TEST CASE 1: Single-Test Report (Diabetes Profile) ──
def test_single_test_fasting_blood_sugar():
    """Verify single-test Fasting Blood Sugar: NO hallucinated panels."""
    text = """
    Patient Name: Anita Sen
    Age: 45 Yrs / Female
    Test: GLUCOSE, FASTING, PLASMA
    Result: 245.00 mg/dL
    Reference: 70.00 - 100.00 mg/dL
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Anita Sen"
    assert ir.gender == "Female"
    assert len(ir.all_results) == 1
    assert ir.all_results[0].status == "HIGH"
    assert ir.all_results[0].numeric_value == 245.0

    sanitized = validate_and_sanitize_summary({}, ir)
    summary_lower = sanitized["summary"].lower()

    assert "245" in sanitized["summary"]
    assert "elevated" in summary_lower or "high" in summary_lower
    # Zero hallucination check
    for forbidden in ["ecg", "cardiovascular", "electrolyte", "liver", "kidney", "nutritional", "all normal"]:
        assert forbidden not in summary_lower


# ── TEST CASE 2: Thyroid Profile (Hypothyroidism) ──
def test_thyroid_profile_hypothyroid():
    """Verify Thyroid report: TSH high, T3/T4 low."""
    text = """
    Patient Name: Priya Sharma
    Age/Gender: 34 Yrs / Female
    Date: 20/Aug/2026

    THYROID PROFILE
    Total Triiodothyronine (T3) 0.45 ng/mL 0.80 - 2.00
    Total Thyroxine (T4) 3.10 µg/dL 5.10 - 14.10
    TSH - Thyroid Stimulating Hormone 12.80 µIU/mL 0.35 - 4.94
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Priya Sharma"
    assert len(ir.all_results) == 3

    results = {r.test_name.lower(): r for r in ir.all_results}
    tsh = next(r for name, r in results.items() if "tsh" in name)
    t3 = next(r for name, r in results.items() if "t3" in name or "triiodothyronine" in name)
    t4 = next(r for name, r in results.items() if "t4" in name or "thyroxine" in name)

    assert tsh.status == "HIGH"
    assert t3.status == "LOW"
    assert t4.status == "LOW"

    sanitized = validate_and_sanitize_summary({}, ir)
    summary_lower = sanitized["summary"].lower()
    # Must NOT mention ECG or Liver
    assert "ecg" not in summary_lower
    assert "liver" not in summary_lower


# ── TEST CASE 3: Acute Liver Injury (Hepatitis Profile) ──
def test_acute_liver_function():
    """Verify Acute LFT: Markedly elevated transaminases, normal kidney."""
    text = """
    Customer Name: Vikram Malhotra
    Age/Gender: 29 Yrs / Male
    LIVER FUNCTION TEST
    Bilirubin - Total 4.50 mg/dL 0.2 - 1.2
    Bilirubin - Direct 2.80 mg/dL 0.0 - 0.3
    SGOT (AST) 520 U/L 0 - 35
    SGPT (ALT) 680 U/L 10 - 45
    Alkaline Phosphatase 210 U/L 40 - 130
    Protein Total 6.8 g/dL 6.0 - 8.0
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Vikram Malhotra"
    assert len(ir.all_results) == 6

    results = {r.test_name.lower(): r for r in ir.all_results}
    ast = next(r for name, r in results.items() if "ast" in name)
    alt = next(r for name, r in results.items() if "alt" in name)
    bili = next(r for name, r in results.items() if "bilirubin" in name and "total" in name)
    prot = next(r for name, r in results.items() if "protein" in name)

    assert ast.status == "HIGH"
    assert alt.status == "HIGH"
    assert bili.status == "HIGH"
    assert prot.status == "NORMAL"


# ── TEST CASE 4: Complete Blood Count with Infection / Thrombocytopenia ──
def test_cbc_thrombocytopenia():
    """Verify CBC: High TLC (Leukocytosis), Low Platelets."""
    text = """
    Patient Name: Ramesh Patel
    Age/Gender: 52 Yrs / Male
    HAEMATOLOGY
    Hemoglobin 14.2 g/dL 13.0 - 17.0
    Total Leucocyte Count 18.5 10^3/µL 4.0 - 11.0
    Platelet Count 45 10^3/µL 150 - 450
    Neutrophils 85 % 40 - 75
    Lymphocytes 10 % 20 - 40
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Ramesh Patel"

    results = {r.test_name.lower(): r for r in ir.all_results}
    tlc = next(r for name, r in results.items() if "leucocyte" in name)
    plt = next(r for name, r in results.items() if "platelet" in name)
    hb = next(r for name, r in results.items() if "hemoglobin" in name)

    assert tlc.status == "HIGH"
    assert plt.status == "LOW"
    assert hb.status == "NORMAL"


# ── TEST CASE 5: Completely Normal Health Checkup ──
def test_all_normal_health_check():
    """Verify All-Normal report: Correctly identified as 0 abnormal values."""
    text = """
    Patient Name: Sunita Rao
    Age/Gender: 28 Yrs / Female
    Hemoglobin 13.5 g/dL 12.0 - 15.0
    Fasting Blood Sugar 85 mg/dL 70 - 100
    Total Cholesterol 160 mg/dL 0 - 200
    Serum Creatinine 0.80 mg/dL 0.6 - 1.2
    SGOT 22 U/L 0 - 35
    SGPT 20 U/L 10 - 40
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Sunita Rao"
    assert len(ir.all_results) == 6
    assert len(ir.abnormal_results) == 0
    assert len(ir.normal_results) == 6


# ── TEST CASE 6: Multi-Panel Comprehensive Pathology Regression ──
def test_multi_panel_comprehensive_regression():
    """Regression test on 15 multi-panel pathology parameters."""
    text = """
    Customer Name : Mr.RAJIV VERMA
    Age/Gender : 62Y 7M 10D /Male
    Collection Date : 11/Aug/2026 09:55AM

    Hemoglobin 11.7 g/dL 13.0-17.0
    RDW-CV 17.0 % 11.5-14
    Glycosylated Hemoglobin (HbA1c) 6.3 % 4 - 5.6
    Cholesterol - HDL 36 mg/dL >= 39.5
    Cholesterol - LDL 138 mg/dl <= 99.9
    LDL : HDL Cholesterol 3.80 Ratio 0 - 3.5
    Homocysteine 34.18 umol/L 3.7-13.9
    SGOT (Aspartate Aminotransferase) 17 U/L 0-34
    SGPT (Alanine Transaminase) 15 U/L 10-49
    Bilirubin - Total 0.77 mg/dL 0.2 - 1.1
    Blood Urea Nitrogen 8 mg/dL 9.0 - 23.0
    Creatinine 0.86 mg/dL 0.7-1.3
    eGFR 98 mL/min/1.73m2 60 - 120
    Ferritin 9.90 ng/mL 22-322
    Immunoglobulin E (IgE) Total 563 IU/mL 0 - 158
    Apolipoprotein - A1 111.00 mg/dL 79-169
    Blood 1+ Negative
    Longitudinal Left axis deviation, possible old inferior MI
    """
    ir = parse_lab_report_text(text)
    results = {r.test_name.lower(): r for r in ir.all_results}

    assert results["ferritin"].status == "LOW"
    assert results["immunoglobulin e (ige) total"].status == "HIGH"
    assert results["sgot (ast)"].status == "NORMAL"
    assert results["sgpt (alt)"].status == "NORMAL"
    assert results["bilirubin - total"].status == "NORMAL"
    assert results["cholesterol - ldl"].status == "HIGH"
    assert results["cholesterol - hdl"].status == "LOW"
    assert results["glycosylated hemoglobin (hba1c)"].status == "HIGH"
    assert results["blood urea nitrogen"].status == "LOW"
    assert results["creatinine"].status == "NORMAL"
    assert results["egfr"].status == "NORMAL"
    assert results["apolipoprotein - a1"].status == "NORMAL"
    assert results["ldl : hdl cholesterol"].status == "HIGH"
    assert results["urine blood"].status == "ABNORMAL"
    assert len(ir.ecg_findings) > 0


# ── TEST CASE 7: Hybrid Scanned Report (USG + ECG + PFT) ──
def test_hybrid_usg_ecg_pft_report():
    """Verify hybrid diagnostic report: extracts USG, ECG, and PFT findings."""
    text = """
    Customer Name : Mr.RAJIV VERMA
    Age/Gender : 62 Y 0 M 0 D /Male
    Collection Date : 11/Aug/2026

    ULTRASOUND WHOLE ABDOMEN
    Liver is mildly enlarged in size (153 mm), and shows diffusely increased echotexture.
    Both kidneys show normal size. No hydronephrosis noted.
    Prostate is enlarged in size measures 48 x 44 x 41 mm vol - 47 cc.
    Impression: MILD HEPATOMEGALY WITH GRADE I/II FATTY CHANGES. PROSTATOMEGALY.

    Section: ecg
    P/QRS/T Axis (deg: 15. 1/26.4/20. 1
    QT/QTc ms : 381/415
    Longitudinal Left axis deviation, possible old inferior MI

    PFT / Spirometry
    Obstructive abnormality:Very serious
    Restrictive anomaly:Very serious
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Rajiv Verma"
    assert len(ir.ecg_findings) > 0
    assert len(ir.radiology_findings) >= 2
    assert len(ir.pft_findings) >= 2

    sanitized = validate_and_sanitize_summary({}, ir)
    assert len(sanitized["abnormal_values"]) >= 4
    labels = [a["label"] for a in sanitized["abnormal_values"]]
    assert "ECG Finding" in labels
    assert "USG / Radiology Finding" in labels
    assert "PFT / Spirometry Finding" in labels


# ── TEST CASE 8: Reference-First Column Layout (hospital investigation summary) ──
def test_reference_first_investigation_summary():
    """Hospital sheets print reference, then unit, then one result column per visit.

    This layout used to parse to zero results, which the guard then read as "no
    evidence for any panel" and stripped the lipid and thyroid findings out of
    a summary that had them right.
    """
    text = """
    SIR GANGA RAM HOSPITAL
    INVESTIGATION SUMMARY
    Name : MR SANJEEV BHATIA Registration No. : 0884903
    Age : 62 Yrs Episode No. : OP16484377
    Gender : Male Date of Admission : 25-Jul-2026 10:06 AM
    Investigation Bio. Ref. Interval Units (25-Jul-2026 (28-May-2026
    GLYCATED Hb (HbA1c) < 5.70 % 6.60 8.60
    TOTAL CHOLESTEROL < 190.00 mg/dL 112.00
    HDL CHOLESTEROL > 40.00 mg/dL 44.00
    *LDL CHOLESTEROL < 100.00 mg/dL 58.00
    TRIGLYCERIDES, SERUM < 150.00 mg/dL 70.00
    *NON - HDL < 130.00 mg/dL 68
    TSH 0.27 - 4.20 uIU/mL 2.800
    """
    ir = parse_lab_report_text(text)
    assert ir.patient_name == "Sanjeev Bhatia"
    assert ir.age == "62 Yrs"
    assert ir.gender == "Male"
    assert ir.date == "25-Jul-2026"
    assert len(ir.all_results) == 7

    results = {r.test_name.lower(): r for r in ir.all_results}
    hba1c = results["glycated hb (hba1c)"]
    assert hba1c.status == "HIGH"
    # The current visit is the first result column, not the previous 8.60.
    assert hba1c.numeric_value == 6.60
    assert results["total cholesterol"].status == "NORMAL"
    # "> 40.00" is a floor, so 44 is normal — not a value above a ceiling.
    assert results["hdl cholesterol"].status == "NORMAL"
    assert results["ldl cholesterol"].status == "NORMAL"
    assert results["non - hdl"].status == "NORMAL"
    assert results["tsh"].status == "NORMAL"
    assert results["tsh"].category == "Thyroid Profile"
    assert len(ir.abnormal_results) == 1


# ── TEST CASE 9: Reference-First Patterns Must Not Fire On Prose Or Legends ──
def test_reference_first_patterns_ignore_prose_and_legends():
    """The new patterns end-anchor on a result, so tables of ranges stay out."""
    text = """
    TSH REFERENCE INTERVALS IN PREGNANCY
    1st trimester 0.1 - 2.5 mIU/L
    2nd trimester 0.2 - 3.0 mIU/L
    Desirable Total Cholesterol < 200.00 mg/dL
    Optimal LDL < 100.00 mg/dL
    NS1 antigen is detectable as early as 5 days after fever starts and usually
    lasts 30 to 90 days in primary infection.
    """
    ir = parse_lab_report_text(text)
    assert ir.all_results == []


# ── TEST CASE 10: Document Text Is Evidence When The Parser Reads Nothing ──
def test_grounding_keeps_panels_the_document_itself_names():
    """An unparseable layout must not strip panels the report plainly contains."""
    raw_text = """
    LIPID PROFILE, SERUM
    TOTAL CHOLESTEROL < 190.00 mg/dL 112.00
    THYROID - STIMULATING HORMONE (TSH), SERUM
    TSH 0.27 - 4.20 uIU/mL 2.800
    """
    ir = parse_lab_report_text("Nothing parseable here.")
    assert ir.all_results == []

    model = {
        "summary": (
            "Total cholesterol is 112.00 mg/dL. "
            "TSH is 2.800 uIU/mL, inside its reference interval."
        ),
        "key_findings": ["Total cholesterol 112.00 mg/dL", "TSH 2.800 uIU/mL"],
        "abnormal_values": [],
    }
    sanitized = validate_and_sanitize_summary(model, ir, raw_text=raw_text)
    assert "cholesterol" in sanitized["summary"].lower()
    assert "tsh" in sanitized["summary"].lower()
    assert len(sanitized["key_findings"]) == 2


# ── TEST CASE 11: Panels The Document Never Mentions Are Still Stripped ──
def test_grounding_still_strips_panels_with_no_evidence_anywhere():
    """The hallucination guard must survive the document-evidence relaxation."""
    ir = parse_lab_report_text("Nothing parseable here.")
    model = {
        "summary": "Liver function is normal. Renal parameters including creatinine are unremarkable.",
        "key_findings": ["Liver enzymes normal", "Creatinine normal"],
        "abnormal_values": [],
    }
    sanitized = validate_and_sanitize_summary(model, ir, raw_text="A chest radiograph was performed.")
    assert "liver" not in sanitized["summary"].lower()
    assert "creatinine" not in sanitized["summary"].lower()
    assert sanitized["key_findings"] == []


# ── TEST CASE 12: Unverified Abnormals Survive Instead Of Being Blanked ──
def test_abnormal_values_kept_when_engine_verified_nothing():
    """An empty engine list is the absence of a finding, not a finding of none."""
    ir = parse_lab_report_text("Nothing parseable here.")
    model = {
        "summary": "Haemoglobin is low at 9.1 g/dL.",
        "key_findings": ["Haemoglobin 9.1 g/dL"],
        "abnormal_values": [
            {"label": "Haemoglobin", "value": "9.1 g/dL", "reference": "13.0 - 17.0", "direction": "low"},
            {"label": "", "value": "", "direction": "high"},  # dropped: no content
            "not a dict",                                     # dropped: wrong shape
        ],
    }
    sanitized = validate_and_sanitize_summary(model, ir, raw_text="Haemoglobin 9.1 g/dL")
    assert len(sanitized["abnormal_values"]) == 1
    assert sanitized["abnormal_values"][0]["label"] == "Haemoglobin"
    assert sanitized["abnormal_values"][0]["direction"] == "low"


def test_verified_abnormals_still_override_the_model():
    """When the engine did read values, its list stays authoritative."""
    text = """
    Patient Name: Anita Sen
    Hemoglobin 14.2 g/dL 13.0 - 17.0
    Platelet Count 45 10^3/µL 150 - 450
    """
    ir = parse_lab_report_text(text)
    model = {"summary": "x", "key_findings": [], "abnormal_values": [
        {"label": "Invented Test", "value": "999", "direction": "high"},
    ]}
    sanitized = validate_and_sanitize_summary(model, ir, raw_text=text)
    labels = [a["label"] for a in sanitized["abnormal_values"]]
    assert "Invented Test" not in labels
    assert any("platelet" in l.lower() for l in labels)


# ── TEST CASE 13: Panel-Scoped Normality Survives Alongside An Abnormality ──
def test_panel_scoped_normal_claim_survives_an_abnormal_result():
    """"The lipid profile is all normal" is true next to a high HbA1c."""
    text = """
    Patient Name: Sanjeev Bhatia
    Glycosylated Hemoglobin (HbA1c) 6.6 % 4 - 5.6
    Total Cholesterol 112 mg/dL 0 - 190
    Triglycerides 70 mg/dL 0 - 150
    """
    ir = parse_lab_report_text(text)
    assert len(ir.abnormal_results) == 1

    model = {
        "summary": (
            "HbA1c is elevated at 6.6%. "
            "The lipid profile parameters are all within normal limits."
        ),
        "key_findings": ["Lipid profile: all parameters within normal limits"],
        "abnormal_values": [],
    }
    sanitized = validate_and_sanitize_summary(model, ir, raw_text=text)
    assert "lipid" in sanitized["summary"].lower()
    assert sanitized["key_findings"] == ["Lipid profile: all parameters within normal limits"]


def test_report_wide_normal_claim_still_removed():
    """The dangerous claim — that the whole report is clear — must still go."""
    text = """
    Patient Name: Sanjeev Bhatia
    Glycosylated Hemoglobin (HbA1c) 6.6 % 4 - 5.6
    Total Cholesterol 112 mg/dL 0 - 190
    """
    ir = parse_lab_report_text(text)
    model = {
        "summary": "All parameters are within normal limits. No abnormal findings were noted.",
        "key_findings": ["No abnormal findings"],
        "abnormal_values": [],
    }
    sanitized = validate_and_sanitize_summary(model, ir, raw_text=text)
    assert "no abnormal findings" not in sanitized["summary"].lower()
    assert "all parameters are within normal limits" not in sanitized["summary"].lower()
    # The false claim is replaced by the finding that contradicted it, not by
    # an empty list.
    assert all("no abnormal findings" not in f.lower() for f in sanitized["key_findings"])
    assert any("hba1c" in f.lower() for f in sanitized["key_findings"])


def test_all_clear_that_names_a_normal_panel_but_covers_the_report_is_removed():
    """A panel named *after* the quantifier does not scope the claim."""
    text = """
    Patient Name: Sanjeev Bhatia
    Glycosylated Hemoglobin (HbA1c) 6.6 % 4 - 5.6
    Total Cholesterol 112 mg/dL 0 - 190
    """
    ir = parse_lab_report_text(text)
    model = {
        "summary": "All parameters, including the lipid profile, are within normal limits.",
        "key_findings": [],
        "abnormal_values": [],
    }
    sanitized = validate_and_sanitize_summary(model, ir, raw_text=text)
    assert "all parameters" not in sanitized["summary"].lower()


# ── TEST CASE 14: One Assay Printed Under Two Names ──
def test_synonym_rows_collapse_to_one_result():
    """Labs print HbA1c under both spellings; the doctor should see it once."""
    text = """
    Name : MR SANJEEV BHATIA Registration No. : 0884903
    GLYCATED Hb (HbA1c) < 5.70 % 6.60 8.60
    GLYCOSYLATED Hb (HbA1c) < 5.70 % 6.60 8.60
    """
    ir = parse_lab_report_text(text)
    assert len(ir.all_results) == 1
    assert len(ir.abnormal_results) == 1
    assert ir.all_results[0].status == "HIGH"


def test_distinct_tests_sharing_a_value_are_both_kept():
    """Two real results that happen to match must never be collapsed."""
    text = """
    Patient Name: Ramesh Patel
    Monocyte Count 5 % 2 - 10
    Eosinophil Count 5 % 2 - 10
    """
    ir = parse_lab_report_text(text)
    assert len(ir.all_results) == 2
