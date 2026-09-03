"""Local inference sidecar for the OPD system.

Bound to localhost and called only by the NestJS backend — it has no auth of its
own and must never be exposed publicly.

Everything it runs is open-source and local: faster-whisper for speech, Ollama
for the LLM, Tesseract for OCR. No request leaves this machine.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import claude_llm, documents, gemini_llm, llm, transcribe
from rapidfuzz import fuzz

from .spellfix import TRUSTED_THRESHOLD, speller
from .config import settings
from .prompts import consolidate as consolidate_prompt
from .prompts import prescription as prescription_prompt
from .prompts import prescription_claude as prescription_claude_prompt
from .prompts import progress as progress_prompt
from .prompts import report_summary as report_prompt
from .schemas import (
    PRESCRIPTION_JSON_SCHEMA,
    PROGRESS_JSON_SCHEMA,
    REPORT_SUMMARY_JSON_SCHEMA,
    ConsolidateRequest,
    ConsolidateResponse,
    DraftMedicine,
    DraftPrescription,
    ExtractPrescriptionRequest,
    ExtractPrescriptionResponse,
    HealthResponse,
    ProgressRequest,
    ProgressResponse,
    ProgressSummary,
    ProgressTrend,
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


# ── Keeping the event loop free ───────────────────────────────
#
# Whisper, OCR and PDF parsing are blocking CPU work. Called straight from an
# async endpoint they occupy the only thread the server has, so while one report
# is being read nothing else is served — not another request, not even /health,
# which is why a single wedged document made the backend report the whole
# service as unreachable. Each now runs in a worker thread instead.
#
# Threads alone are not enough, so both are also bounded:
#
#   * a faster-whisper model object cannot take concurrent calls, so
#     transcriptions are admitted one per model in the pool (WHISPER_POOL_SIZE,
#     default 1) — off the loop, so everything else still answers while they
#     run. transcribe.py checks a model out per request and is the real guard;
#     this semaphore just parks the waiting requests on the event loop instead
#     of tying up a worker thread each.
#   * OCR is CPU-bound; a couple in parallel saturates the machine, and more
#     just makes every one of them slower.
_TRANSCRIBE_SLOT = asyncio.Semaphore(max(1, settings.whisper_pool_size))
_OCR_SLOTS = asyncio.Semaphore(2)


def _save_upload(upload: UploadFile) -> str:
    suffix = os.path.splitext(upload.filename or "")[1]
    if not suffix:
        ct = (upload.content_type or "").lower()
        if "pdf" in ct:
            suffix = ".pdf"
        elif "jpeg" in ct or "jpg" in ct:
            suffix = ".jpg"
        elif "png" in ct:
            suffix = ".png"
        elif "text" in ct:
            suffix = ".txt"
        else:
            suffix = ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        upload.file.seek(0)
    except Exception:
        pass
    with os.fdopen(fd, "wb") as handle:
        handle.write(upload.file.read())
    return path


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    # "Can this service run an LLM request?" — which is not the same question
    # as "is Ollama up". Asked the old way, a deployment running on Claude with
    # no Ollama installed reported itself degraded forever, and the backend
    # gates its startup sweep of unfinished report summaries on status == "ok",
    # so those were never retried on a host that was in fact perfectly healthy.
    #
    # Ollama is probed only when it is the backend actually being relied on,
    # which also keeps a dead OLLAMA_URL from spending the caller's timeout.
    llm_ok = settings.cloud_llm_configured or await llm.is_reachable()
    whisper_ok = transcribe.is_loaded()
    return HealthResponse(
        status="ok" if (llm_ok and whisper_ok) else "degraded",
        whisper_loaded=whisper_ok,
        whisper_model=settings.whisper_model,
        llm_reachable=llm_ok,
        # The model that will actually serve a request, not the Ollama name it
        # would have used: reporting qwen while Claude does the work made this
        # field actively misleading when debugging a deployment.
        llm_model=settings.active_llm,
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

    path = await asyncio.to_thread(_save_upload, audio)
    try:
        async with _TRANSCRIBE_SLOT:
            text, language, duration = await asyncio.to_thread(
                transcribe.transcribe, path, catalog
            )
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


# A readable report carries real words and real numbers. OCR on a blurred or
# low-resolution photo returns neither — it returns short letter-noise like
# "owe oe" repeated down the page, which is not empty, so it used to sail past
# the emptiness check and be summarised as though it were a clean report.
_WORDS = re.compile(r"[A-Za-z]{4,}")
_NUMBERS = re.compile(r"\d")

_UNREADABLE_BLANK = (
    "No text could be read from this file. The photo may be blurred, too dark, "
    "or the page may be blank. Please open the file directly, or ask the patient "
    "for a clearer scan or the original PDF."
)
_UNREADABLE_GARBLED = (
    "The text came out garbled, so this report cannot be read reliably — most "
    "likely a blurred or low-resolution photo. Please open the file directly, or "
    "ask the patient for a clearer scan or the original PDF."
)
_UNREADABLE_NO_VALUES = (
    "No test values could be read from this file. Please open the file directly, "
    "or ask the patient for a clearer scan or the original PDF."
)


def _unreadable_reason(text: str) -> str | None:
    """Why this extraction cannot be trusted, or None if it looks usable.

    Deliberately biased toward refusing: telling a doctor "I could not read
    this" when the scan was in fact fine costs them one click on the file.
    Summarising letter-noise instead can tell them an unread report is normal.
    """
    if not text.strip():
        return _UNREADABLE_BLANK
    if len(_WORDS.findall(text)) < 5:
        return _UNREADABLE_GARBLED
    if not _NUMBERS.search(text):
        return _UNREADABLE_NO_VALUES
    return None


def _unreadable_response(reason: str, chars: int, method) -> SummarizeReportResponse:
    return SummarizeReportResponse(
        summary=ReportSummary(
            summary=reason,
            key_findings=[],
            abnormal_values=[],
            report_type="Could not be read",
        ),
        extracted_chars=chars,
        extraction_method=method,
        model_version=settings.model_version,
    )


@app.post("/summarize-report", response_model=SummarizeReportResponse)
async def summarize_report(file: UploadFile = File(...)) -> SummarizeReportResponse:
    path = await asyncio.to_thread(_save_upload, file)
    try:
        async with _OCR_SLOTS:
            text, method = await asyncio.to_thread(
                documents.extract_text, path, file.content_type or ""
            )
    finally:
        os.unlink(path)

    # Say why it is unreadable, rather than failing blankly or — worse — running
    # a summariser over noise. This returns 200 with an explicit "could not be
    # read" summary so the doctor sees the reason where they expect the report,
    # instead of a generic failure they can only retry.
    reason = _unreadable_reason(text)
    if reason:
        log.info("Refusing to summarise: %s (%d chars via %s)", reason[:60], len(text), method)
        return _unreadable_response(reason, len(text), method)

    from . import lab_parser, contradiction_guard

    # 1. Deterministic extraction and reference range validation. Regex work
    #    over a whole report is still real CPU time, so it stays off the loop.
    ir = await asyncio.to_thread(lab_parser.parse_lab_report_text, text)
    user_prompt = report_prompt.build_user_from_ir(ir, raw_text=text)

    raw = None
    if settings.claude_enabled and settings.claude_api_key:
        try:
            raw = await claude_llm.generate_json(
                system=report_prompt.SYSTEM,
                user=user_prompt,
                schema=REPORT_SUMMARY_JSON_SCHEMA,
                # A doctor reads a summary closely, and these run a
                # fraction as often as extraction, so they can afford
                # the deeper setting.
                effort="high",
            )
        except Exception as claude_err:
            log.warning("Claude summarization failed (%s), falling back.", claude_err)

    if raw is None and settings.gemini_enabled and settings.gemini_api_key:
        try:
            raw = await gemini_llm.generate_json(
                system=report_prompt.SYSTEM,
                user=user_prompt,
                schema=REPORT_SUMMARY_JSON_SCHEMA,
            )
        except Exception as gemini_err:
            log.warning("Gemini report summarization failed (%s), falling back to local LLM.", gemini_err)

    if raw is None:
        try:
            raw = await llm.generate_json(
                system=report_prompt.SYSTEM,
                user=user_prompt,
                schema=REPORT_SUMMARY_JSON_SCHEMA,
            )
        except llm.LlmError as err:
            raise HTTPException(503, str(err)) from err

    # 2. Contradiction Guard & Consistency Enforcement
    sanitized = contradiction_guard.validate_and_sanitize_summary(raw, ir, raw_text=text)

    return SummarizeReportResponse(
        summary=ReportSummary.model_validate(sanitized),
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

    raw = None
    if settings.claude_enabled and settings.claude_api_key:
        try:
            raw = await claude_llm.generate_json(
                system=consolidate_prompt.SYSTEM,
                user=consolidate_prompt.build_user(payload),
                schema=REPORT_SUMMARY_JSON_SCHEMA,
                # A doctor reads a summary closely, and these run a
                # fraction as often as extraction, so they can afford
                # the deeper setting.
                effort="high",
            )
        except Exception as claude_err:
            log.warning("Claude summarization failed (%s), falling back.", claude_err)

    if raw is None and settings.gemini_enabled and settings.gemini_api_key:
        try:
            raw = await gemini_llm.generate_json(
                system=consolidate_prompt.SYSTEM,
                user=consolidate_prompt.build_user(payload),
                schema=REPORT_SUMMARY_JSON_SCHEMA,
            )
        except Exception as gemini_err:
            log.warning("Gemini consolidate summaries failed (%s), falling back to local LLM.", gemini_err)

    if raw is None:
        try:
            raw = await llm.generate_json(
                system=consolidate_prompt.SYSTEM,
                user=consolidate_prompt.build_user(payload),
                schema=REPORT_SUMMARY_JSON_SCHEMA,
            )
        except Exception as err:
            log.warning("Consolidate LLM failed (%s), falling back to deterministic consolidation.", err)
            combined_summary_parts = [r.summary.strip() for r in reports if (r.summary or "").strip()]
            combined_findings = []
            for r in reports:
                combined_findings.extend(r.key_findings)
            raw = {
                "summary": " ".join(combined_summary_parts),
                "key_findings": combined_findings[:8],
                "abnormal_values": [],
                "report_type": "Consolidated Reports",
                "title": f"Combined Summary ({len(reports)} reports)",
            }

    # Preserve all authoritative abnormal values across all source reports
    collected_abnormals = []
    seen_abn_keys = set()
    for r in reports:
        for a in r.abnormal_values:
            key = f"{a.label.lower()}:{a.value}"
            if key not in seen_abn_keys:
                seen_abn_keys.add(key)
                collected_abnormals.append(a.model_dump())
    if collected_abnormals:
        raw["abnormal_values"] = collected_abnormals

    return ConsolidateResponse(
        summary=ReportSummary.model_validate(raw),
        source_count=len(reports),
        model_version=settings.model_version,
    )


def _numeric(value: str) -> float | None:
    """Leading number in a value like '11.4 g/dL'. None when there isn't one."""
    m = re.search(r"-?\d+(?:\.\d+)?", value or "")
    return float(m.group()) if m else None


def _flag_map(visit) -> dict[str, tuple[str, str, str]]:
    """Measurements of one visit, keyed lowercase for cross-visit matching.

    Value is (printed label, value, high|low|abnormal|normal) — the printed
    label is kept so the trends table shows the lab's own spelling rather than a
    lowercased one.
    """
    out: dict[str, tuple[str, str, str]] = {}
    for r in visit.reports:
        for a in r.abnormal_values:
            label = (a.label or "").strip()
            if label:
                out[label.lower()] = (
                    label,
                    a.value or "",
                    a.direction or "abnormal",
                )
    return out


def _interpret(
    before_flag: str, after_flag: str, direction: str, model_said: str | None
) -> str:
    """Is this movement good or bad for the patient?

    Derived from the lab's own out-of-range flags rather than asked of the
    model: a low value rising is moving toward its range, a high value rising is
    moving away from it. That is arithmetic, not medical knowledge, and models
    routinely leave this field out — which would strip the trends table of the
    one thing the doctor actually reads it for.

    The model's answer is used only where the flags cannot decide.
    """
    if after_flag == "normal" and before_flag != "normal":
        return "better"
    if before_flag == "normal" and after_flag != "normal":
        return "worse"
    if direction == "same":
        return "unclear"
    if before_flag == "low":
        return "better" if direction == "up" else "worse"
    if before_flag == "high":
        return "better" if direction == "down" else "worse"
    return model_said or "unclear"


def _derive_status(trends: list[ProgressTrend], model_status: str) -> str:
    """Keep the headline consistent with the table underneath it.

    A chip reading "improving" above a table of worsening values is worse than
    no chip at all. Unanimous trends decide it outright; a genuinely mixed
    picture needs weighing that only the model can do, so its verdict stands.
    """
    if not trends:
        return "unclear"
    better = sum(1 for t in trends if t.interpretation == "better")
    worse = sum(1 for t in trends if t.interpretation == "worse")
    if better and not worse:
        return "improving"
    if worse and not better:
        return "worsening"
    if not better and not worse:
        return "unclear"
    return model_status if model_status in ("improving", "worsening", "stable") else "stable"


def _ground_trends(summary: ProgressSummary, previous, current) -> ProgressSummary:
    """Rebuild the trends table from the data rather than trusting the model.

    Which measurements can be compared, and what their two values are, is a fact
    about the reports — not a judgement. Deriving it here means the table is
    always complete (models routinely return it empty) and can never contain a
    comparison that did not happen, which is the one output on this page capable
    of actively misleading a doctor.

    The model is still the source of `interpretation`: whether a rise is good or
    bad is medical knowledge, not arithmetic. Anything it did not label is left
    "unclear" rather than guessed.
    """
    prev_flags = _flag_map(previous)
    curr_flags = _flag_map(current)
    # Everything measured at both visits, in the current visit's spelling.
    keys = [k for k in curr_flags if k in prev_flags]

    said = {t.label.strip().lower(): t for t in summary.trends}
    invented = [
        t.label for t in summary.trends if t.label.strip().lower() not in keys
    ]
    if invented:
        log.warning("Discarded invented trend(s): %s", ", ".join(invented))

    rebuilt: list[ProgressTrend] = []
    for key in keys:
        _, prev_value, prev_flag = prev_flags[key]
        label, curr_value, curr_flag = curr_flags[key]

        before, after = _numeric(prev_value), _numeric(curr_value)
        if before is None or after is None or after == before:
            direction = "same"
        else:
            direction = "up" if after > before else "down"

        hit = said.get(key)
        rebuilt.append(
            ProgressTrend(
                label=label,
                previous_value=prev_value,
                current_value=curr_value,
                direction=direction,
                interpretation=_interpret(
                    prev_flag,
                    curr_flag,
                    direction,
                    hit.interpretation if hit else None,
                ),
            )
        )

    summary.trends = rebuilt
    summary.status = _derive_status(rebuilt, summary.status)
    return summary


@app.post("/summarize-progress", response_model=ProgressResponse)
async def summarize_progress(body: ProgressRequest) -> ProgressResponse:
    """Compare the previous visit against the current one.

    Both visits arrive as already-computed summaries, so this is text-in,
    text-out — no OCR, and much faster than /summarize-report.
    """
    previous_reports = [r for r in body.previous.reports if (r.summary or "").strip()]
    current_reports = [r for r in body.current.reports if (r.summary or "").strip()]
    if not previous_reports or not current_reports:
        raise HTTPException(
            422, "Both a previous and a current visit summary are required."
        )

    def payload(reports):
        return [
            {
                "title": r.title,
                "summary": r.summary,
                "key_findings": r.key_findings,
                "abnormal_values": [a.model_dump() for a in r.abnormal_values],
            }
            for r in reports
        ]

    user = progress_prompt.build_user(
        (body.patient.model_dump() if body.patient else {}),
        {"visit_date": body.previous.visit_date, "reports": payload(previous_reports)},
        {"visit_date": body.current.visit_date, "reports": payload(current_reports)},
    )

    raw = None
    if settings.claude_enabled and settings.claude_api_key:
        try:
            raw = await claude_llm.generate_json(
                system=progress_prompt.SYSTEM,
                user=user,
                schema=PROGRESS_JSON_SCHEMA,
                # A doctor reads a summary closely, and these run a
                # fraction as often as extraction, so they can afford
                # the deeper setting.
                effort="high",
            )
        except Exception as claude_err:
            log.warning("Claude summarization failed (%s), falling back.", claude_err)

    if raw is None and settings.gemini_enabled and settings.gemini_api_key:
        try:
            raw = await gemini_llm.generate_json(
                system=progress_prompt.SYSTEM,
                user=user,
                schema=PROGRESS_JSON_SCHEMA,
            )
        except Exception as gemini_err:
            log.warning(
                "Gemini progress summary failed (%s), falling back to local LLM.",
                gemini_err,
            )

    if raw is None:
        try:
            raw = await llm.generate_json(
                system=progress_prompt.SYSTEM,
                user=user,
                schema=PROGRESS_JSON_SCHEMA,
            )
        except llm.LlmError as err:
            raise HTTPException(503, str(err)) from err

    summary = _ground_trends(
        ProgressSummary.model_validate(raw), body.previous, body.current
    )

    return ProgressResponse(
        summary=summary,
        visit_count=2,
        model_version=f"{settings.model_version}+{progress_prompt.VERSION}",
    )


# ── Grounding guard for prescription extraction ───────────────
#
# The prompt tells the model to leave unspoken fields blank, but a prompt is a
# request, not a guarantee — models reliably "helpfully" complete a strength or
# a timing nobody said. These cues let us check the transcript deterministically
# and strip anything that was never spoken, so an invented dose can't reach a
# prescription the doctor only skims.

_FREQUENCY_CUES = re.compile(
    r"\b(subah|shaam|dopahar|raat|baar|khali\s+pet|bedtime|sone\s+se\s+pehle"
    # English times of day count as a spoken frequency too ("Montair LC at
    # night"). Without these the guard below strips a dose the doctor did give.
    r"|morning|afternoon|evening|night|nightly"
    r"|once|twice|thrice|one|two|three|four|\d+\s*times?"
    r"|times?\s+(?:a|in\s+a|per)\s+day|daily|od|bd|tds|qid|sos"
    r"|jab\s+bukhar|dard\s+hone\s+par|as\s+needed|hourly)\b",
    re.IGNORECASE,
)

# Only genuine food-timing phrases count. Bare "khana"/"khane" must NOT: in
# "Paracetamol subah shaam khana" the word is the verb "to take", not a
# statement about food, and treating it as one lets "after food" through.
_TIMING_CUES = re.compile(
    r"(khana\s+khane\s+ke\s+baad|khane\s+ke\s+baad"
    r"|khana\s+khane\s+se\s+pehle|khane\s+se\s+pehle|khali\s+pet"
    r"|\b(?:after|before|with)\s+(?:food|meals?|breakfast|lunch|dinner|eating)\b"
    r"|\bempty\s+stomach\b|\bbedtime\b|sone\s+se\s+pehle)",
    re.IGNORECASE,
)

_FORM_CUES = re.compile(
    r"\b(goli|tablet|tab|tabs|capsule|cap|caps|syrup|syp|chammach|ml"
    r"|injection|inj|drops|drop|ointment|cream|gel|inhaler|spray|sachet|powder"
    r"|suspension|lotion)\b",
    re.IGNORECASE,
)

_DURATION_CUES = re.compile(
    r"\b(din|dino|days?|hafta|haftey|weeks?|mahina|mahine|months?|saal|years?)\b",
    re.IGNORECASE,
)

# Spoken frequency -> the phrase written on the prescription. Order matters: the
# scanner below takes the first alternative that matches, so the more specific
# phrasings must come before the shorter ones they contain. Every count accepts
# a singular "time" as well as "times" — doctors dictate "2 time in a day".
_FREQUENCY_FORMS: list[tuple[str, str]] = [
    # three times daily. The three slots may be named with either "raat" or
    # "shaam" as the last one, optionally joined by commas or "aur".
    (r"subah[\s,]+(?:aur\s+)?dopahar[\s,]+(?:aur\s+)?(?:shaam|raat)", "Thrice a day"),
    (r"din\s+me\s+teen\s+baar", "Thrice a day"),
    (r"teen\s+baar", "Thrice a day"),
    (r"thrice\s+(?:a|in\s+a|per)\s+day", "Thrice a day"),
    (r"three\s+times?\s+(?:a|in\s+a|per)\s+day", "Thrice a day"),
    (r"3\s*times?\s+(?:a|in\s+a|per)\s+day", "Thrice a day"),
    (r"tds\b", "Thrice a day"),
    # twice daily
    (r"subah\s+aur\s+shaam", "Twice a day"),
    (r"subah\s+shaam", "Twice a day"),
    (r"din\s+me\s+do\s+baar", "Twice a day"),
    (r"do\s+baar", "Twice a day"),
    (r"twice\s+(?:a|in\s+a|per)\s+day", "Twice a day"),
    (r"two\s+times?\s+(?:a|in\s+a|per)\s+day", "Twice a day"),
    (r"2\s*times?\s+(?:a|in\s+a|per)\s+day", "Twice a day"),
    (r"bd\b", "Twice a day"),
    # once daily
    (r"once\s+(?:a|in\s+a|per)\s+day", "Once a day"),
    (r"once\s+daily", "Once a day"),
    (r"one\s+times?\s+(?:a|in\s+a|per)\s+day", "Once a day"),
    (r"1\s*times?\s+(?:a|in\s+a|per)\s+day", "Once a day"),
    (r"ek\s+baar", "Once a day"),
    # Single time-of-day doses. Listed last so the multi-word forms above win
    # (e.g. "subah shaam" must not be read as a bare morning dose).
    (r"raat\s+me\s+ek", "Once a day"),
    (r"raat\s+ko", "Once a day"),
    (r"at\s+night", "Once a day"),
    (r"night\s+only", "Once a day"),
    (r"nightly", "Once a day"),
    (r"at\s+bedtime", "Once a day"),
    (r"bedtime", "Once a day"),
    (r"in\s+the\s+morning", "Once a day"),
    (r"morning\s+only", "Once a day"),
    (r"in\s+the\s+afternoon", "Once a day"),
    (r"dopahar\s+me", "Once a day"),
    # Bare Hindi time-of-day words, last of all. A doctor saying only "Pantocid
    # subah" means a morning dose; without these the medicine would inherit the
    # next medicine's schedule instead. Every multi-word form above is tried
    # first, so "subah shaam" is never split into two single-slot doses.
    (r"subah", "Once a day"),
    (r"dopahar", "Once a day"),
    (r"shaam", "Once a day"),
    (r"raat", "Once a day"),
]

# Spoken food timing -> canonical value. Ordered specific-first, same as above.
_TIMING_FORMS: list[tuple[str, str]] = [
    (r"khana\s+khane\s+ke\s+baad", "after food"),
    (r"khane\s+ke\s+baad", "after food"),
    (r"after\s+(?:food|meals?|eating|breakfast|lunch|dinner)", "after food"),
    (r"khana\s+khane\s+se\s+pehle", "before food"),
    (r"khane\s+se\s+pehle", "before food"),
    (r"khali\s+pet", "before food"),
    (r"before\s+(?:food|meals?|eating|breakfast|lunch|dinner)", "before food"),
    (r"empty\s+stomach", "before food"),
    (r"sone\s+se\s+pehle", "at bedtime"),
    (r"at\s+bedtime", "at bedtime"),
]


def _compile(forms: list[tuple[str, str]]) -> re.Pattern[str]:
    return re.compile(
        "|".join(f"(?P<f{i}>{pat})" for i, (pat, _) in enumerate(forms)),
        re.IGNORECASE,
    )


_FREQUENCY_SCANNER = _compile(_FREQUENCY_FORMS)
_TIMING_SCANNER = _compile(_TIMING_FORMS)


def _attribute_to_medicines(
    draft: DraftPrescription,
    transcript: str,
    scanner: re.Pattern[str],
    forms: list[tuple[str, str]],
) -> dict[int, str]:
    """Map medicine index -> the value spoken for it, by position.

    Each medicine takes the first value spoken after its own name. That one rule
    covers both shapes: in "Dolo 500 aur Pantocid 40, subah shaam" both names
    precede the single phrase, so both take it; in "Paracetamol 3 times a day,
    and Dolo 2 time in a day" each name is followed by its own.

    A medicine with nothing after it is left out, so the caller keeps whatever
    the model produced — the doctor may have phrased it in a way these patterns
    do not cover, and inheriting a neighbouring medicine's dose would be worse.
    """
    hits: list[tuple[int, str]] = []
    for match in scanner.finditer(transcript):
        index = int(match.lastgroup[1:])  # type: ignore[union-attr]
        hits.append((match.start(), forms[index][1]))
    if not hits:
        return {}

    lowered = transcript.lower()
    resolved: dict[int, str] = {}
    for i, med in enumerate(draft.medicines):
        name = med.name.strip().lower()
        if not name:
            continue
        at = lowered.find(name)
        if at < 0:
            continue  # spelled differently in the transcript
        following = [(pos, value) for pos, value in hits if pos >= at]
        if following:
            resolved[i] = min(following)[1]
    return resolved


def _apply_spoken_schedule(draft: DraftPrescription, transcript: str) -> None:
    """Pin frequency and food timing to what the doctor actually said."""
    for i, dosage in _attribute_to_medicines(
        draft, transcript, _FREQUENCY_SCANNER, _FREQUENCY_FORMS
    ).items():
        draft.medicines[i].dosage = dosage

    # There is no `timing` field any more, so spoken food timing becomes the
    # medicine's instruction. Only filled when the model left it empty: unlike
    # dosage, instructions can legitimately carry more than these patterns know
    # about ("with warm water"), and overwriting that would lose it.
    for i, timing in _attribute_to_medicines(
        draft, transcript, _TIMING_SCANNER, _TIMING_FORMS
    ).items():
        med = draft.medicines[i]
        if not med.instructions.strip():
            med.instructions = timing[:1].upper() + timing[1:]




# Placeholder text models reach for when a field has nothing to say. The schema
# requires every key, so "nothing" has to be an empty string — these are the
# ways that comes back looking like content.
_EMPTY_PLACEHOLDERS = re.compile(
    r"^\s*(?:to\s+be\s+taken\s+|take\s+|use\s+)?"
    r"(?:not\s+specified|not\s+mentioned|not\s+stated|not\s+given|none|n/?a|"
    r"nil|unknown|as\s+directed|as\s+advised|as\s+prescribed|as\s+per\s+doctor|"
    r"not\s+applicable|-{1,2})"
    r"(?:\s+by\s+(?:the\s+)?doctor)?\s*\.?\s*$",
    re.IGNORECASE,
)

# Frequency phrases -> the one phrase the clinic prints. Matched against the
# model's own `dosage` output, not the transcript: the model reliably works out
# HOW OFTEN, and just as reliably writes it back in the doctor's words. Wording
# is mechanical, so it is settled here instead of with more prompt text.
_DOSAGE_CANON: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(once|1)\s*(a|per|every|in\s+a)?\s*week(ly)?\b|\bweekly\b|\bevery\s+week\b", re.I), "Once a week"),
    (re.compile(r"\b(once|1)?\s*(a|per|every|in\s+a)?\s*month(ly)?\b|\bevery\s+month\b", re.I), "Once a month"),
    (re.compile(r"\b(alternate|every\s+other)\s+day\b|\bek\s+din\s+chhod", re.I), "Alternate day"),
    (re.compile(r"\b(four\s+times?|4\s*times?|qid|chaar\s+baar)\b", re.I), "Four times a day"),
    (re.compile(r"\b(thrice|three\s+times?|3\s*times?|tds|tid|teen\s+baar)\b", re.I), "Thrice a day"),
    (re.compile(r"\b(twice|two\s+times?|2\s*times?|bd|bid|do\s+baar|subah\s+shaam)\b", re.I), "Twice a day"),
    (re.compile(r"\b(sos|as\s+needed|when\s+required|prn)\b", re.I), "SOS (as needed)"),
    (re.compile(r"\b(once|one\s+time|1\s*time|od|ek\s+baar|daily|every\s*day)\b", re.I), "Once a day"),
]
# "every 10 days" / "once per 10days" -> "Once every 10 days". Checked first:
# an interval also matches the plain "once" rule above.
_DOSAGE_INTERVAL = re.compile(
    r"\b(?:once\s+)?(?:per|every|each|in)\s*(\d+)\s*(day|week|month)s?\b", re.I
)
# A strength the model wrote without a space: "1000mg" -> "1000 mg".
_STRENGTH_SPACING = re.compile(r"(\d)\s*(mg|mcg|ml|gm?|iu|units?)\b", re.I)


def _canonical_dosage(spoken: str) -> str:
    """Rewrite a frequency into the phrase the clinic prints, or keep it."""
    text = spoken.strip()
    if not text or _EMPTY_PLACEHOLDERS.match(text):
        return ""
    interval = _DOSAGE_INTERVAL.search(text)
    if interval:
        n, unit = interval.group(1), interval.group(2).lower()
        if n == "1":
            return {"day": "Once a day", "week": "Once a week", "month": "Once a month"}[unit]
        return f"Once every {n} {unit}s"
    for pattern, canon in _DOSAGE_CANON:
        if pattern.search(text):
            return canon
    # Unrecognised but non-empty: the doctor said something this table does not
    # cover. Keep it — losing a real frequency is worse than an odd phrasing.
    return text[:1].upper() + text[1:]


def _normalise_draft(draft: DraftPrescription, transcript: str) -> None:
    """Settle the mechanical parts of the draft in code, not in the prompt.

    The model is good at working out WHAT the doctor said — which medicines,
    which schedule belongs to which, what the diagnosis is. It is much less
    reliable at writing that out in one fixed house format, and adding more
    prompt text asking it to has stopped paying: the rules are read, and the
    output still comes back in the doctor's own words.

    So the split is: the model decides meaning, this function decides wording.
    Nothing here invents a value — it only rewrites, or blanks, one the model
    already produced.
    """
    spoken_forms = {m.group(0).lower() for m in _FORM_CUES.finditer(transcript)}
    # "thrice a day" is a frequency, and models keep reading the 3 as a number
    # of days. A duration needs a duration word somewhere in the dictation.
    has_duration = bool(_DURATION_CUES.search(transcript))

    for med in draft.medicines:
        for field in ("strength", "form", "dosage", "instructions"):
            if _EMPTY_PLACEHOLDERS.match(getattr(med, field) or ""):
                setattr(med, field, "")

        if med.strength:
            med.strength = _STRENGTH_SPACING.sub(r"\1 \2", med.strength).strip()

        med.dosage = _canonical_dosage(med.dosage)

        # A form is only real if its word was spoken. Same check as strength and
        # just as cheap — and "tablet" is the single most tempting thing for a
        # model to fill in, because it is right most of the time.
        if med.form and not any(
            form_word in med.form.lower() or med.form.lower() in form_word
            for form_word in spoken_forms
        ):
            log.info("Dropping ungrounded form %r for %r.", med.form, med.name)
            med.form = ""

        if med.duration_days is not None and not has_duration:
            log.info(
                "Dropping ungrounded duration %s for %r — the transcript names "
                "no days, weeks or months.", med.duration_days, med.name,
            )
            med.duration_days = None

        # Instructions must not repeat the frequency or the duration; both print
        # in their own column, and the model keeps echoing them here.
        if med.instructions:
            low = med.instructions.strip().lower()
            duration_echo = med.duration_days is not None and re.fullmatch(
                rf"(for\s+)?{med.duration_days}\s*(day|days|din)\.?", low
            )
            if duration_echo or _canonical_dosage(low) == med.dosage != "":
                log.info(
                    "Dropping instruction %r for %r — already in another field.",
                    med.instructions, med.name,
                )
                med.instructions = ""
            else:
                med.instructions = med.instructions.strip()

    draft.advice = [a.strip() for a in draft.advice if a.strip() and not _EMPTY_PLACEHOLDERS.match(a)]
    draft.warnings = [w.strip() for w in draft.warnings if w.strip()]



def _same_medicine(a: DraftMedicine, b: DraftMedicine) -> bool:
    return a.name.strip().lower() == b.name.strip().lower()


def _compatible(a: DraftMedicine, b: DraftMedicine) -> bool:
    """True when nothing the two rows both fill in disagrees."""
    for field in ("strength", "form", "dosage", "instructions"):
        x, y = getattr(a, field).strip().lower(), getattr(b, field).strip().lower()
        if x and y and x != y:
            return False
    if a.duration_days is not None and b.duration_days is not None:
        if a.duration_days != b.duration_days:
            return False
    return True


def _merge_duplicate_medicines(draft: DraftPrescription) -> None:
    """Collapse rows that are one medicine written twice.

    A drug named more than once in a dictation is still one line on the
    prescription, but the model sometimes emits a row per mention — once bare
    when the name is first said, once filled in when the schedule follows.

    Merging only happens when the two rows agree everywhere they overlap. Two
    rows for the same drug at different strengths or schedules is a taper, which
    doctors really do prescribe, so those are kept and flagged for the doctor
    rather than silently collapsed into one.
    """
    merged: list[DraftMedicine] = []
    for med in draft.medicines:
        target = next(
            (m for m in merged if _same_medicine(m, med) and _compatible(m, med)),
            None,
        )
        if target is None:
            merged.append(med)
            continue
        for field in ("strength", "form", "dosage", "instructions"):
            if not getattr(target, field).strip() and getattr(med, field).strip():
                setattr(target, field, getattr(med, field))
        if target.duration_days is None and med.duration_days is not None:
            target.duration_days = med.duration_days
        log.info("Merged a duplicate row for %r.", med.name)

    if len(merged) != len(draft.medicines):
        log.info(
            "Medicines: %d row(s) merged down to %d.",
            len(draft.medicines), len(merged),
        )
    draft.medicines = merged

    # Same drug still on two rows means the values genuinely differ. That is a
    # taper if the doctor meant it and a mistake if they did not — either way
    # the doctor should look before issuing.
    seen: dict[str, int] = {}
    for med in draft.medicines:
        key = med.name.strip().lower()
        if key:
            seen[key] = seen.get(key, 0) + 1
    for name, count in seen.items():
        if count > 1:
            draft.warnings.append(
                f"{name.title()} appears on {count} rows with different "
                f"instructions — confirm this is intended."
            )

def _verify_advice(draft: DraftPrescription, transcript: str) -> None:
    """Delete advice the model could not point at in the transcript.

    Prompt rules alone did not hold this down: generic, plausible advice — rest,
    fluids, avoid spicy food — kept appearing for consultations where the doctor
    said none of it, because it is what a doctor usually says. Asking for the
    source span makes the claim checkable, and an unverifiable claim gets
    dropped instead of argued with.

    Matching is fuzzy (partial_ratio) rather than exact: the model reformats
    whitespace and punctuation when it copies, and that should not cost a real
    line. An invented span scores nowhere near the floor.
    """
    if not draft.advice:
        draft.advice_sources = []
        return

    haystack = " ".join(transcript.lower().split())
    kept: list[str] = []
    for i, line in enumerate(draft.advice):
        source = draft.advice_sources[i] if i < len(draft.advice_sources) else ""
        needle = " ".join(source.lower().split())
        if not needle:
            log.info("Dropping advice %r — the model cited no source for it.", line)
            continue
        score = fuzz.partial_ratio(needle, haystack)
        if score < _ADVICE_SOURCE_FLOOR:
            log.info(
                "Dropping advice %r — cited source %r is not in the transcript "
                "(score %.0f).", line, source, score,
            )
            continue
        kept.append(line)

    if len(kept) != len(draft.advice):
        log.info("Advice: kept %d of %d line(s).", len(kept), len(draft.advice))
    draft.advice = kept
    # Done its job — callers never see it.
    draft.advice_sources = []

# How close a cited span must be to something actually in the transcript.
# Generous: the model retypes punctuation and spacing when it copies, and a
# real line should survive that. Invented spans score far below this.
_ADVICE_SOURCE_FLOOR = 80

# A real follow-up names a day or a gap. "in the next visit" / "agli baar"
# name neither, and treating them as one books the patient a phantom
# appointment that the clinic then calls them about.
_FOLLOW_UP_CUES = re.compile(
    r"\b\d{1,2}\s*(?:st|nd|rd|th)\b"
    r"|\b\d{1,2}\s*(?:ko|tarikh|tareekh)\b"
    r"|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d"
    r"|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b"
    r"|\b(?:kal|parso|tomorrow)\b"
    r"|\b(?:next|agle|agli)\s+(?:week|month|hafte|mahine|hafta|mahina)\b"
    r"|\b(?:after|baad|later|in|within)\s+(?:\w+\s+)?"
    r"(?:din|dino|days?|hafta|haftey|hafte|weeks?|mahina|mahine|months?)\b"
    r"|\b(?:din|dino|days?|hafta|haftey|hafte|weeks?|mahina|mahine|months?)"
    r"\s+(?:baad|later)\b",
    re.IGNORECASE,
)


# An advice line that is really the follow-up restated.
_RETURN_VISIT = re.compile(
    r"\b(follow[\s-]?up|come\s+back|revisit|visit(s|ing)?\s+(me|again|back)|"
    r"see\s+me\s+(again|on)|report\s+back|dikha(na|ne|ye))\b",
    re.IGNORECASE,
)


def _reconcile_follow_up(
    draft: DraftPrescription, today: date, transcript: str
) -> None:
    """Make follow_up_date and follow_up_days agree, then name it in advice.

    The doctor speaks one or the other — "come on the 25th" or "come back in a
    week" — and the backend today reads only the day count. Deriving the missing
    half here means neither caller has to care which was said.

    A date that will not parse, or that has already passed, is dropped rather
    than repaired: a follow-up in the past is worse than none at all.
    """
    if (draft.follow_up_days or draft.follow_up_date) and not _FOLLOW_UP_CUES.search(
        transcript
    ):
        log.info(
            "Dropping ungrounded follow-up (date=%r days=%s) — the transcript "
            "names neither a date nor a gap.",
            draft.follow_up_date, draft.follow_up_days,
        )
        draft.follow_up_days = None
        draft.follow_up_date = ""

    # The model writes the return visit into advice as well, often echoing the
    # garbled tail of the dictation ("...make sure that he visits me on 25th").
    # Stripped on every path, including the one where the follow-up itself was
    # just dropped — otherwise the phantom appointment survives as advice text.
    # Narrow on purpose: a line only goes if it is explicitly a follow-up or
    # carries a date, so genuine safety-netting advice ("come back if the fever
    # does not settle") is left alone.
    draft.advice = [
        line for line in draft.advice
        if not (
            _RETURN_VISIT.search(line)
            and ("follow" in line.lower() or _FOLLOW_UP_CUES.search(line))
        )
    ]

    parsed: date | None = None
    if draft.follow_up_date:
        try:
            parsed = datetime.strptime(draft.follow_up_date.strip(), "%Y-%m-%d").date()
        except ValueError:
            log.info("Discarding unparseable follow_up_date %r.", draft.follow_up_date)
            draft.follow_up_date = ""
        else:
            if parsed < today:
                log.info("Discarding follow_up_date %s — already past.", parsed)
                draft.follow_up_date = ""
                parsed = None

    if parsed is not None:
        draft.follow_up_days = (parsed - today).days
    elif draft.follow_up_days and draft.follow_up_days > 0:
        parsed = today + timedelta(days=draft.follow_up_days)
        draft.follow_up_date = parsed.isoformat()
    else:
        draft.follow_up_days = None
        draft.follow_up_date = ""
        return

    # The prompt asks for this line, but the follow-up is the last thing said in
    # a consultation and the easiest to drop, so it is guaranteed here instead.
    draft.advice.append(f"Follow-up visit on {parsed.strftime('%d %B %Y')}")

def _dictates_medicines(transcript: str) -> bool:
    """Whether a transcript looks like it names something to prescribe.

    Deliberately loose: this only decides whether an empty result is worth a
    second attempt, so the cost of saying yes too often is one extra call on a
    request that already came back with nothing. A doctor who genuinely
    prescribed nothing still ends up with an empty draft either way.
    """
    words = re.findall(r"[A-Za-z]{3,}", transcript)
    return len(words) >= 1


def _drop_ungrounded_strength(draft: DraftPrescription, transcript: str) -> None:
    """Blank a strength whose number the doctor never said.

    Split out of _drop_ungrounded_fields because it is the one check worth
    running against every backend, however good: a strength is the single field
    where a plausible guess carries a dose-sized consequence, and the check is
    cheap and specific — the digits either appear in the transcript or they do
    not.
    """
    digits_spoken = set(re.findall(r"\d+", transcript))
    for med in draft.medicines:
        if not med.strength:
            continue
        strength_digits = set(re.findall(r"\d+", med.strength))
        if not strength_digits or not strength_digits.issubset(digits_spoken):
            log.info(
                "Dropping ungrounded strength %r for %r — not in transcript.",
                med.strength,
                med.name,
            )
            med.strength = ""


def _drop_advice_restating_medicines(draft: DraftPrescription) -> None:
    """Drop advice lines that only repeat a prescribed medicine.

    Advice is meant for what the patient should do *besides* taking the
    medicines. A line naming a drug duplicates a row the doctor is already
    reading, so it is noise regardless of which model wrote it.
    """
    names = [m.name.strip().lower() for m in draft.medicines if m.name.strip()]
    if not names:
        return
    kept = [
        line for line in draft.advice
        if not any(name in line.lower() for name in names)
    ]
    if len(kept) != len(draft.advice):
        log.info(
            "Dropping %d advice line(s) that restate a medicine.",
            len(draft.advice) - len(kept),
        )
    draft.advice = kept


def _drop_ungrounded_fields(draft: DraftPrescription, transcript: str) -> None:
    """Blank any medicine field the transcript gives no basis for.

    Deliberately conservative: a field is cleared only when the transcript
    contains no cue for it at all. Doing it the other way round — trusting the
    model and hoping — is how "300 mg, 1-0-1, after food" ends up on a
    prescription for someone who only said "take Paracetamol 3 times a day".

    The cue lists are necessarily incomplete, so this also blanks the
    occasional field the doctor genuinely spoke. That trade is right for the
    local 3B and wrong for a model that segments the sentence properly, which
    is why the caller runs it selectively.
    """
    _drop_ungrounded_strength(draft, transcript)

    has_frequency = bool(_FREQUENCY_CUES.search(transcript))
    has_timing = bool(_TIMING_CUES.search(transcript))
    has_form = bool(_FORM_CUES.search(transcript))
    has_duration = bool(_DURATION_CUES.search(transcript))

    for med in draft.medicines:
        if med.dosage and not has_frequency:
            log.info("Dropping ungrounded dosage %r for %r.", med.dosage, med.name)
            med.dosage = ""

        if med.form and not has_form:
            log.info("Dropping ungrounded form %r for %r.", med.form, med.name)
            med.form = ""

        # Instructions carry the food timing now, so this is where an unspoken
        # "khane ke baad" shows up. If the dictation mentions food nowhere, an
        # instruction asserting it is invented.
        if med.instructions and not has_timing and _TIMING_CUES.search(med.instructions):
            log.info(
                "Dropping ungrounded instruction %r for %r.", med.instructions, med.name
            )
            med.instructions = ""

        if med.duration_days is not None and not has_duration:
            log.info(
                "Dropping ungrounded duration %r for %r.", med.duration_days, med.name
            )
            med.duration_days = None

    _drop_advice_restating_medicines(draft)


@app.post("/extract-prescription", response_model=ExtractPrescriptionResponse)
async def extract_prescription(
    body: ExtractPrescriptionRequest,
) -> ExtractPrescriptionResponse:
    if not body.transcript.strip():
        raise HTTPException(422, "Transcript is empty — nothing to extract.")

    # Resolved once so the prompt, the follow-up arithmetic and the log all
    # agree even if the request straddles midnight.
    today = date.today()

    def prompt_for(module) -> tuple[str, str]:
        return module.SYSTEM, module.build_user(
            transcript=body.transcript,
            patient_name=body.patient.name,
            age=body.patient.age,
            gender=body.patient.gender,
            complaint=body.patient.complaint,
            medicine_catalog=body.medicine_catalog,
            today=today.isoformat(),
        )

    # The local and Gemini paths keep the prompt they were tuned against, so
    # switching the provider back behaves exactly as it did before. Claude gets
    # its own, which can be far shorter because the guards below do the
    # mechanical work its rules used to have to describe.
    system, user = prompt_for(prescription_prompt)

    async def generate() -> tuple[dict, str]:
        """One extraction attempt, best available backend first.

        Returns the raw object *and* which backend produced it. The caller needs
        to know: the regex grounding guards further down were written to catch a
        3B model, and applied to a frontier model's output they subtract more
        than they add.
        """
        if settings.claude_enabled and settings.claude_api_key:
            claude_system, claude_user = prompt_for(prescription_claude_prompt)
            try:
                raw = await claude_llm.generate_json(
                    claude_system, claude_user, PRESCRIPTION_JSON_SCHEMA
                )
                return raw, "claude"
            except Exception as claude_err:
                log.warning(
                    "Claude extraction failed (%s), falling back to Gemini/Ollama.",
                    claude_err,
                )
        if settings.gemini_enabled and settings.gemini_api_key:
            try:
                raw = await gemini_llm.generate_json(
                    system, user, PRESCRIPTION_JSON_SCHEMA
                )
                return raw, "gemini"
            except Exception as gemini_err:
                log.warning(
                    "Gemini extraction failed (%s), falling back to local Ollama LLM.",
                    gemini_err,
                )
        try:
            return await llm.generate_json(system, user, PRESCRIPTION_JSON_SCHEMA), "ollama"
        except llm.LlmError as err:
            raise HTTPException(503, str(err)) from err

    raw_draft, provider = await generate()
    draft = DraftPrescription.model_validate(raw_draft)

    # An empty medicine list from a transcript that plainly dictates medicines
    # is the model failing, not the doctor saying nothing.
    #
    # Observed in production: "Dolo 200 twice a day, Paracetamol 500 times a
    # day." returned no medicines twice in a row, while the identical request
    # replayed afterwards returned both every time. The doctor sees a blank
    # prescription and no error, because nothing technically went wrong.
    #
    # Sampling is not deterministic, so asking again is usually enough. One
    # retry only — the cost lands solely on a request that already failed, and
    # a genuine "no medication today" must still be allowed to come back empty.
    if not draft.medicines and _dictates_medicines(body.transcript):
        log.warning(
            "No medicines extracted from %d chars that look like a prescription; "
            "retrying on the local model.",
            len(body.transcript),
        )
        # Deliberately the local model, not another Gemini call. Gemini has
        # just looked at this transcript and found nothing, so asking it again
        # is the least informative thing to do — and its free tier allows only
        # 20 requests a day, which a doubled call burns through fast. The local
        # model is a genuinely different opinion and costs nothing.
        async def second_opinion() -> tuple[dict, str]:
            if settings.local_llm_enabled:
                return (
                    await llm.generate_json(system, user, PRESCRIPTION_JSON_SCHEMA),
                    "ollama",
                )
            # No local model on this host. Rather than let the safety net
            # quietly disappear along with Ollama, ask Claude again: the
            # failure this retry was written for is sampling non-determinism —
            # the same transcript returning nothing once and both medicines the
            # next time — so a second call is still the right move, even to the
            # same backend. An empty draft the doctor cannot tell from a real
            # "no medication today" is the outcome worth spending a call to avoid.
            if settings.claude_enabled and settings.claude_api_key:
                claude_system, claude_user = prompt_for(prescription_claude_prompt)
                return (
                    await claude_llm.generate_json(
                        claude_system, claude_user, PRESCRIPTION_JSON_SCHEMA
                    ),
                    "claude",
                )
            raise llm.LlmError("No backend available for a second opinion.")

        try:
            retry_raw, retry_provider = await second_opinion()
            retry = DraftPrescription.model_validate(retry_raw)
        # Broad on purpose: this is a best-effort net over a request that has
        # already failed, so nothing it raises may replace the draft we hold.
        except Exception as retry_err:
            log.warning("Retry failed (%s); returning the empty draft.", retry_err)
        else:
            if retry.medicines:
                log.info(
                    "Retry on %s recovered %d medicine(s).",
                    retry_provider,
                    len(retry.medicines),
                )
                draft = retry
                # Stamped with whichever backend actually produced this draft:
                # `provider` decides below whether the regex grounding guards
                # run, and those were written to catch a 3B model. Leaving it
                # reading "ollama" after Claude answered would apply them to
                # frontier output, where they subtract more than they add.
                provider = retry_provider
            else:
                log.warning("Retry also found none; returning an empty draft.")

    # Both regex passes here — this one and _drop_ungrounded_fields below —
    # exist to catch a 3B model. One overwrites the model's dosage from a
    # positional guess; the other blanks any field whose spoken cue the patterns
    # do not recognise. Against a model that segments the sentence correctly
    # they cost more than they save: a doctor who says "roz do baar" or
    # "chhe sau pachaas" loses a field the model had right. So they run only for
    # the backends that still need them.
    trust_model = provider == "claude"

    if not trust_model:
        # Runs before spell-correction below, which rewrites names away from the
        # wording the transcript actually used.
        _apply_spoken_schedule(draft, body.transcript)

    # Correct the spelling of each medicine name and normalize strength & dosage numbers
    for med in draft.medicines:
        # If name has trailing strength (e.g. "Dolo 500" or "Paracetamol 200mg" or "Dolo 600mg"):
        match = re.search(r"^(.*?)\s*(\d+\s*(?:mg|mcg|ml|g|iu)?\.?)$", med.name.strip(), re.IGNORECASE)
        if match:
            clean_name, extracted_str = match.group(1).strip(), match.group(2).strip()
            if clean_name:
                med.name = clean_name
            if not med.strength:
                if re.match(r"^\d+$", extracted_str):
                    med.strength = f"{extracted_str} mg"
                else:
                    med.strength = extracted_str

        # If strength is a bare number like "500", format as "500 mg"
        if med.strength and re.match(r"^\d+$", med.strength.strip()):
            med.strength = f"{med.strength.strip()} mg"

        # Claude already writes the real drug name (prompt rule 8), so the
        # dictionary is held to typo-level matches only — it has a few hundred
        # entries and its nearest match for anything outside them is a
        # different molecule, not a better spelling.
        med.name = speller.correct(
            med.name,
            extra=body.medicine_catalog,
            threshold=TRUSTED_THRESHOLD if trust_model else None,
        )

    # Nothing above may invent a field. Strip any value the model supplied that
    # the doctor never spoke — the prompt forbids it, but the prompt is a
    # request, not a guarantee, and an unspoken dose reaching a prescription is
    # exactly the failure this service must not have.
    if trust_model:
        # Two of the checks are worth keeping whoever produced the draft: an
        # unspoken strength is the single guess with a dose-sized consequence,
        # and advice that restates a medicine row is duplication either way.
        _drop_ungrounded_strength(draft, body.transcript)
        _drop_advice_restating_medicines(draft)
    else:
        _drop_ungrounded_fields(draft, body.transcript)

    # What actually came out, per request. Without this, a draft that reaches
    # the doctor empty is indistinguishable from one the model never filled —
    # the HTTP 200 looks identical either way.
    _merge_duplicate_medicines(draft)
    _verify_advice(draft, body.transcript)
    _normalise_draft(draft, body.transcript)
    _reconcile_follow_up(draft, today, body.transcript)

    if draft.warnings:
        log.info("Model raised %d warning(s): %s", len(draft.warnings), draft.warnings)

    log.info(
        "Extracted %d medicine(s) via %s from %d chars of transcript: %s",
        len(draft.medicines),
        provider,
        len(body.transcript),
        [m.name for m in draft.medicines] or "none",
    )

    # The provider that actually answered, not the one we intended: a Claude
    # outage silently answered from Ollama for a whole debugging session because
    # this said "claude-opus-5" either way.
    actual = settings.claude_model if provider == "claude" else (
        settings.gemini_model if provider == "gemini" else settings.llm_model
    )
    return ExtractPrescriptionResponse(
        prescription=draft,
        model_version=f"whisper:{settings.whisper_model}|rx:{actual}",
    )
