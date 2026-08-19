"""Request/response contracts shared with the NestJS backend.

The `*_JSON_SCHEMA` constants are handed to Ollama's `format` parameter, which
constrains decoding to the schema — the model physically cannot emit malformed
JSON, so the backend never has to defend against a half-written object.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

# ── Transcription ────────────────────────────────────────────


class TranscribeResponse(BaseModel):
    text: str
    language: str
    duration_seconds: float
    model_version: str


# ── Report summary ───────────────────────────────────────────


class AbnormalValue(BaseModel):
    label: str = Field(description="Test name, e.g. 'Haemoglobin'")
    value: str = Field(description="Measured value with unit, e.g. '9.1 g/dL'")
    reference: str = Field(default="", description="Normal range if printed")
    direction: Literal["high", "low", "abnormal"] = "abnormal"


class ReportSummary(BaseModel):
    summary: str = Field(description="Two or three sentences a doctor can scan")
    key_findings: list[str] = Field(default_factory=list)
    abnormal_values: list[AbnormalValue] = Field(default_factory=list)
    report_type: str = Field(default="", description="e.g. 'CBC', 'Lipid profile'")


class SummarizeReportResponse(BaseModel):
    summary: ReportSummary
    extracted_chars: int
    extraction_method: Literal["pdf_text", "ocr", "none"]
    model_version: str


REPORT_SUMMARY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "report_type": {"type": "string"},
        "summary": {"type": "string"},
        "key_findings": {"type": "array", "items": {"type": "string"}},
        "abnormal_values": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "string"},
                    "reference": {"type": "string"},
                    "direction": {"type": "string", "enum": ["high", "low", "abnormal"]},
                },
                "required": ["label", "value", "direction"],
            },
        },
    },
    "required": ["summary", "key_findings", "abnormal_values", "report_type"],
}


class ReportSummaryInput(BaseModel):
    title: str = ""
    summary: str = ""
    key_findings: list[str] = Field(default_factory=list)
    abnormal_values: list[AbnormalValue] = Field(default_factory=list)


class ConsolidateRequest(BaseModel):
    # The already-computed per-report summaries for one appointment.
    reports: list[ReportSummaryInput] = Field(default_factory=list)


class ConsolidateResponse(BaseModel):
    # Same shape as a single report summary, so clients reuse one renderer.
    summary: ReportSummary
    source_count: int
    model_version: str


# ── Prescription extraction ──────────────────────────────────


class PatientContext(BaseModel):
    name: str = ""
    age: int | None = None
    gender: str = ""
    complaint: str = Field(default="", description="Reason for visit from booking")


class ExtractPrescriptionRequest(BaseModel):
    transcript: str
    patient: PatientContext = Field(default_factory=PatientContext)
    # The clinic's own catalogue. Passed in so the model spells medicines the
    # way this doctor actually prescribes them.
    medicine_catalog: list[str] = Field(default_factory=list)


class DraftMedicine(BaseModel):
    name: str
    strength: str = ""
    form: str = Field(default="", description="tablet | syrup | capsule | injection")
    dosage: str = Field(default="", description="Morning-Afternoon-Night, e.g. '1-0-1'")
    timing: str = Field(default="", description="before food | after food")
    duration_days: int | None = None
    instructions: str = ""


class DraftPrescription(BaseModel):
    diagnosis: str = ""
    medicines: list[DraftMedicine] = Field(default_factory=list)
    advice: list[str] = Field(default_factory=list)
    follow_up_days: int | None = None


class ExtractPrescriptionResponse(BaseModel):
    prescription: DraftPrescription
    model_version: str


PRESCRIPTION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "diagnosis": {"type": "string"},
        "medicines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "strength": {"type": "string"},
                    "form": {"type": "string"},
                    "dosage": {"type": "string"},
                    "timing": {"type": "string"},
                    "duration_days": {"type": ["integer", "null"]},
                    "instructions": {"type": "string"},
                },
                "required": ["name", "dosage"],
            },
        },
        "advice": {"type": "array", "items": {"type": "string"}},
        "follow_up_days": {"type": ["integer", "null"]},
    },
    "required": ["diagnosis", "medicines", "advice"],
}


# ── Health ───────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    whisper_loaded: bool
    whisper_model: str
    llm_reachable: bool
    llm_model: str
    ocr_available: bool
    model_version: str
