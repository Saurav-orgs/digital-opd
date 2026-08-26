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
