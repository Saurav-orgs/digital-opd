"""Local inference sidecar for the OPD system.

Bound to localhost and called only by the NestJS backend — it has no auth of its
own and must never be exposed publicly.

Everything it runs is open-source and local: faster-whisper for speech, Ollama
for the LLM, Tesseract for OCR. No request leaves this machine.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import documents, llm, transcribe
from .spellfix import speller
from .config import settings
from .prompts import consolidate as consolidate_prompt
from .prompts import prescription as prescription_prompt
from .prompts import report_summary as report_prompt
from .schemas import (
    PRESCRIPTION_JSON_SCHEMA,
    REPORT_SUMMARY_JSON_SCHEMA,
    ConsolidateRequest,
    ConsolidateResponse,
    DraftPrescription,
    ExtractPrescriptionRequest,
    ExtractPrescriptionResponse,
    HealthResponse,
    ReportSummary,
    SummarizeReportResponse,
    TranscribeResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("ai-opd")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load Whisper up front: a cold load mid-consultation would look like a hang.
    try:
        transcribe.load_model()
    except Exception as err:
        log.error("Whisper failed to load — /transcribe will return 503. %s", err)
    yield


app = FastAPI(title="OPD AI sidecar", version="1.0.0", lifespan=lifespan)


def _save_upload(upload: UploadFile) -> str:
    suffix = os.path.splitext(upload.filename or "")[1] or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as handle:
        handle.write(upload.file.read())
    return path


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    llm_ok = await llm.is_reachable()
    whisper_ok = transcribe.is_loaded()
    return HealthResponse(
        status="ok" if (llm_ok and whisper_ok) else "degraded",
        whisper_loaded=whisper_ok,
        whisper_model=settings.whisper_model,
        llm_reachable=llm_ok,
        llm_model=settings.llm_model,
        ocr_available=documents.ocr_available(),
        model_version=settings.model_version,
    )


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    # JSON array of medicine names, used to bias decoding toward clinic vocabulary.
    medicine_catalog: str = Form("[]"),
) -> TranscribeResponse:
    if not transcribe.is_loaded():
        raise HTTPException(503, "Speech model is not loaded on this host.")

    try:
        catalog = json.loads(medicine_catalog)
        if not isinstance(catalog, list):
            catalog = []
    except json.JSONDecodeError:
        catalog = []

    path = _save_upload(audio)
    try:
        text, language, duration = transcribe.transcribe(path, catalog)
    except Exception as err:
        log.exception("Transcription failed")
        raise HTTPException(500, f"Transcription failed: {err}") from err
    finally:
        # The audio is never persisted — the backend keeps only the transcript.
        os.unlink(path)

    return TranscribeResponse(
        text=text,
        language=language,
        duration_seconds=duration,
        model_version=settings.model_version,
    )


@app.post("/summarize-report", response_model=SummarizeReportResponse)
async def summarize_report(file: UploadFile = File(...)) -> SummarizeReportResponse:
    path = _save_upload(file)
    try:
        text, method = documents.extract_text(path, file.content_type or "")
    finally:
        os.unlink(path)

    if not text.strip():
        raise HTTPException(
            422,
            "Could not read any text from this file. It may be a blurred photo "
            "or an unsupported format.",
        )

    try:
        raw = await llm.generate_json(
            system=report_prompt.SYSTEM,
            user=report_prompt.build_user(text, was_ocr=(method == "ocr")),
            schema=REPORT_SUMMARY_JSON_SCHEMA,
        )
    except llm.LlmError as err:
        raise HTTPException(503, str(err)) from err

    return SummarizeReportResponse(
        summary=ReportSummary.model_validate(raw),
        extracted_chars=len(text),
        extraction_method=method,
        model_version=settings.model_version,
    )


@app.post("/summarize-reports", response_model=ConsolidateResponse)
async def consolidate_reports(body: ConsolidateRequest) -> ConsolidateResponse:
    """Combine several per-report summaries into one overview for a visit."""
    reports = [r for r in body.reports if (r.summary or "").strip()]
    if not reports:
        raise HTTPException(422, "No report summaries to consolidate.")

    payload = [
        {
            "title": r.title,
            "summary": r.summary,
            "key_findings": r.key_findings,
            "abnormal_values": [a.model_dump() for a in r.abnormal_values],
        }
        for r in reports
    ]
    try:
        raw = await llm.generate_json(
            system=consolidate_prompt.SYSTEM,
            user=consolidate_prompt.build_user(payload),
            schema=REPORT_SUMMARY_JSON_SCHEMA,
        )
    except llm.LlmError as err:
        raise HTTPException(503, str(err)) from err

    return ConsolidateResponse(
        summary=ReportSummary.model_validate(raw),
        source_count=len(reports),
        model_version=settings.model_version,
    )


@app.post("/extract-prescription", response_model=ExtractPrescriptionResponse)
async def extract_prescription(
    body: ExtractPrescriptionRequest,
) -> ExtractPrescriptionResponse:
    if not body.transcript.strip():
        raise HTTPException(422, "Transcript is empty — nothing to extract.")

    try:
        raw = await llm.generate_json(
            system=prescription_prompt.SYSTEM,
            user=prescription_prompt.build_user(
                transcript=body.transcript,
                patient_name=body.patient.name,
                age=body.patient.age,
                gender=body.patient.gender,
                complaint=body.patient.complaint,
                medicine_catalog=body.medicine_catalog,
            ),
            schema=PRESCRIPTION_JSON_SCHEMA,
        )
    except llm.LlmError as err:
        raise HTTPException(503, str(err)) from err

    draft = DraftPrescription.model_validate(raw)
    # Correct the spelling of each medicine name against a real dictionary so a
    # mis-heard name doesn't reach the doctor mangled. Strength/dosage untouched.
    for med in draft.medicines:
        med.name = speller.correct(med.name, extra=body.medicine_catalog)

    return ExtractPrescriptionResponse(
        prescription=draft,
        model_version=settings.model_version,
    )
