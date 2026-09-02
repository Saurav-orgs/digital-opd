"""Request/response contracts shared with the NestJS backend.

The `*_JSON_SCHEMA` constants are handed to Ollama's `format` parameter, which
constrains decoding to the schema — the model physically cannot emit malformed
JSON, so the backend never has to defend against a half-written object.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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
    direction: Literal["high", "low", "abnormal", "normal"] = "abnormal"
    status: str = ""
    category: str = ""


class ReportSummary(BaseModel):
    summary: str = Field(default="", description="Two or three sentences a doctor can scan")
    key_findings: list[str] = Field(default_factory=list)
    abnormal_values: list[AbnormalValue] = Field(default_factory=list)
    # Defaulted, not "": a `mode="before"` validator does not run for a field the
    # model omitted entirely, so an absent report_type would reach the UI blank.
    report_type: str = Field(default="Medical Report", description="e.g. 'CBC', 'Lipid profile'")
    title: str = ""

    @field_validator("report_type", mode="before")
    @classmethod
    def populate_report_type(cls, v: Any) -> str:
        if isinstance(v, str) and v.strip():
            return v.strip()
        return "Medical Report"

    @field_validator("summary", mode="before")
    @classmethod
    def coerce_summary(cls, v: Any) -> str:
        if isinstance(v, list):
            return " ".join(str(item) for item in v)
        return str(v or "")


class SummarizeReportResponse(BaseModel):
    summary: ReportSummary
    extracted_chars: int
    extraction_method: Literal["pdf_text", "ocr", "none"]
    model_version: str


REPORT_SUMMARY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "report_type": {"type": "string"},
        "title": {"type": "string"},
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
    "required": ["summary", "key_findings", "abnormal_values"],
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


# ── Across-visit progress ────────────────────────────────────


class VisitInput(BaseModel):
    """One visit's already-computed report summaries."""

    visit_date: str = ""
    reports: list[ReportSummaryInput] = Field(default_factory=list)


class ProgressRequest(BaseModel):
    patient: "PatientContext | None" = None
    previous: VisitInput
    current: VisitInput


class ProgressTrend(BaseModel):
    label: str
    previous_value: str = ""
    current_value: str = ""
    direction: Literal["up", "down", "same"] = "same"
    # What the movement means clinically — not the same as its direction.
    interpretation: Literal["better", "worse", "unclear"] = "unclear"


class ProgressSummary(BaseModel):
    status: Literal["improving", "stable", "worsening", "unclear"] = "unclear"
    summary: str = ""
    improvements: list[str] = Field(default_factory=list)
    deteriorations: list[str] = Field(default_factory=list)
    unchanged: list[str] = Field(default_factory=list)
    trends: list[ProgressTrend] = Field(default_factory=list)
    current_status: str = ""
    watch_points: list[str] = Field(default_factory=list)

    @field_validator("summary", "current_status", mode="before")
    @classmethod
    def coerce_text(cls, v: Any) -> str:
        if isinstance(v, list):
            return " ".join(str(item) for item in v)
        return str(v or "")


class ProgressResponse(BaseModel):
    summary: ProgressSummary
    visit_count: int
    model_version: str


PROGRESS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {
            "type": "string",
            "enum": ["improving", "stable", "worsening", "unclear"],
        },
        "summary": {"type": "string"},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "deteriorations": {"type": "array", "items": {"type": "string"}},
        "unchanged": {"type": "array", "items": {"type": "string"}},
        "trends": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "previous_value": {"type": "string"},
                    "current_value": {"type": "string"},
                    "direction": {"type": "string", "enum": ["up", "down", "same"]},
                    "interpretation": {
                        "type": "string",
                        "enum": ["better", "worse", "unclear"],
                    },
                },
                "required": ["label", "previous_value", "current_value", "direction"],
            },
        },
        "current_status": {"type": "string"},
        "watch_points": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["status", "summary", "trends"],
}


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
    # Words, not the 1-0-1 grid: doctors dictate "twice a day", and frequencies
    # like "every week" or "alternate day" have no slot in a three-slot grid.
    dosage: str = Field(default="", description="Spoken frequency, e.g. 'Twice a day'")
    duration_days: int | None = None
    # Food timing lives here now — `timing` was dropped, so "after food" and
    # anything else about how to take the medicine share one field.
    instructions: str = Field(default="", description="How to take it, e.g. 'After food'")

    @field_validator("strength", "form", "dosage", "instructions", mode="before")
    @classmethod
    def _coerce_str(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v).strip()


class DraftPrescription(BaseModel):
    diagnosis: str = ""
    medicines: list[DraftMedicine] = Field(default_factory=list)
    advice: list[str] = Field(default_factory=list)
    # For each advice line, the words in the transcript it came from. Asking for
    # a citation makes a fabricated line falsifiable: main.py checks each span
    # is really in the transcript and drops the ones that are not. Never
    # returned to callers — it is dropped once it has done its job.
    advice_sources: list[str] = Field(default_factory=list, exclude=True)
    follow_up_days: int | None = None
    # A doctor who names a date ("come on the 25th") loses it through an
    # integer. Both are returned: the date is what was said, the day count is
    # derived from it so the backend keeps working unchanged.
    follow_up_date: str = Field(default="", description="ISO YYYY-MM-DD if a date was spoken")
    # Plausibility flags for the doctor — never a reason to change a value,
    # only to look at one. Advisory, not persisted.
    warnings: list[str] = Field(default_factory=list)

    @field_validator("diagnosis", mode="before")
    @classmethod
    def _coerce_diagnosis(cls, v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, list):
            return ", ".join(str(x).strip() for x in v if str(x).strip())
        return str(v).strip()

    @field_validator("advice", "warnings", mode="before")
    @classmethod
    def _coerce_advice(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            clean = v.strip()
            return [clean] if clean else []
        if isinstance(v, list):
            return [str(item).strip() for item in v if str(item).strip()]
        return []

    @field_validator("advice_sources", mode="before")
    @classmethod
    def _coerce_advice_sources(cls, v: Any) -> list[str]:
        """Same coercion as advice, except empties are KEPT.

        Position carries the meaning here — sources[i] is the citation for
        advice[i]. Dropping an empty span shifts every later index by one, so a
        line the model failed to cite silently steals its neighbour's citation
        and passes verification.
        """
        if v is None:
            return []
        if isinstance(v, str):
            return [v.strip()]
        if isinstance(v, list):
            return [str(item).strip() for item in v]
        return []


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
                    "duration_days": {"type": ["integer", "null"]},
                    "instructions": {"type": "string"},
                },
                "required": [
                    "name",
                    "strength",
                    "form",
                    "dosage",
                    "duration_days",
                    "instructions",
                ],
            },
        },
        "advice": {"type": "array", "items": {"type": "string"}},
        "advice_sources": {"type": "array", "items": {"type": "string"}},
        "follow_up_days": {"type": ["integer", "null"]},
        "follow_up_date": {"type": "string"},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "diagnosis",
        "medicines",
        "advice",
        "advice_sources",
        "follow_up_days",
        "follow_up_date",
        "warnings",
    ],
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
