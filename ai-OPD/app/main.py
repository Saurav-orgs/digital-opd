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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import documents, gemini_llm, llm, transcribe
from .spellfix import speller
from .config import settings
from .prompts import consolidate as consolidate_prompt
from .prompts import prescription as prescription_prompt
from .prompts import progress as progress_prompt
from .prompts import report_summary as report_prompt
from .schemas import (
    PRESCRIPTION_JSON_SCHEMA,
    PROGRESS_JSON_SCHEMA,
    REPORT_SUMMARY_JSON_SCHEMA,
    ConsolidateRequest,
    ConsolidateResponse,
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
#   * faster-whisper keeps ONE shared model object and concurrent calls into it
#     are not safe, so transcriptions are serialised — one at a time, but off
#     the loop, so everything else still answers while one runs.
#   * OCR is CPU-bound; a couple in parallel saturates the machine, and more
#     just makes every one of them slower.
_TRANSCRIBE_SLOT = asyncio.Semaphore(1)
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
    if settings.gemini_enabled and settings.gemini_api_key:
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
    if settings.gemini_enabled and settings.gemini_api_key:
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
    if settings.gemini_enabled and settings.gemini_api_key:
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

# Spoken frequency -> Morning-Afternoon-Night pattern. Order matters: the
# scanner below takes the first alternative that matches, so the more specific
# phrasings must come before the shorter ones they contain. Every count accepts
# a singular "time" as well as "times" — doctors dictate "2 time in a day".
_FREQUENCY_FORMS: list[tuple[str, str]] = [
    # three times daily. The three slots may be named with either "raat" or
    # "shaam" as the last one, optionally joined by commas or "aur".
    (r"subah[\s,]+(?:aur\s+)?dopahar[\s,]+(?:aur\s+)?(?:shaam|raat)", "1-1-1"),
    (r"din\s+me\s+teen\s+baar", "1-1-1"),
    (r"teen\s+baar", "1-1-1"),
    (r"thrice\s+(?:a|in\s+a|per)\s+day", "1-1-1"),
    (r"three\s+times?\s+(?:a|in\s+a|per)\s+day", "1-1-1"),
    (r"3\s*times?\s+(?:a|in\s+a|per)\s+day", "1-1-1"),
    (r"tds\b", "1-1-1"),
    # twice daily
    (r"subah\s+aur\s+shaam", "1-0-1"),
    (r"subah\s+shaam", "1-0-1"),
    (r"din\s+me\s+do\s+baar", "1-0-1"),
    (r"do\s+baar", "1-0-1"),
    (r"twice\s+(?:a|in\s+a|per)\s+day", "1-0-1"),
    (r"two\s+times?\s+(?:a|in\s+a|per)\s+day", "1-0-1"),
    (r"2\s*times?\s+(?:a|in\s+a|per)\s+day", "1-0-1"),
    (r"bd\b", "1-0-1"),
    # once daily
    (r"once\s+(?:a|in\s+a|per)\s+day", "1-0-0"),
    (r"once\s+daily", "1-0-0"),
    (r"one\s+times?\s+(?:a|in\s+a|per)\s+day", "1-0-0"),
    (r"1\s*times?\s+(?:a|in\s+a|per)\s+day", "1-0-0"),
    (r"ek\s+baar", "1-0-0"),
    # Single time-of-day doses. Listed last so the multi-word forms above win
    # (e.g. "subah shaam" must not be read as a bare morning dose).
    (r"raat\s+me\s+ek", "0-0-1"),
    (r"raat\s+ko", "0-0-1"),
    (r"at\s+night", "0-0-1"),
    (r"night\s+only", "0-0-1"),
    (r"nightly", "0-0-1"),
    (r"at\s+bedtime", "0-0-1"),
    (r"bedtime", "0-0-1"),
    (r"in\s+the\s+morning", "1-0-0"),
    (r"morning\s+only", "1-0-0"),
    (r"in\s+the\s+afternoon", "0-1-0"),
    (r"dopahar\s+me", "0-1-0"),
    # Bare Hindi time-of-day words, last of all. A doctor saying only "Pantocid
    # subah" means a morning dose; without these the medicine would inherit the
    # next medicine's schedule instead. Every multi-word form above is tried
    # first, so "subah shaam" is never split into two single-slot doses.
    (r"subah", "1-0-0"),
    (r"dopahar", "0-1-0"),
    (r"shaam", "0-0-1"),
    (r"raat", "0-0-1"),
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
    """Pin dosage and food timing to what the doctor actually said, per medicine."""
    for i, dosage in _attribute_to_medicines(
        draft, transcript, _FREQUENCY_SCANNER, _FREQUENCY_FORMS
    ).items():
        draft.medicines[i].dosage = dosage

    # Authoritative, not just a fallback: the model likes to put a dosage word
    # ("morning") in `timing`, which means nothing to whoever reads the script.
    for i, timing in _attribute_to_medicines(
        draft, transcript, _TIMING_SCANNER, _TIMING_FORMS
    ).items():
        draft.medicines[i].timing = timing


def _drop_ungrounded_fields(draft: DraftPrescription, transcript: str) -> None:
    """Blank any medicine field the transcript gives no basis for.

    Deliberately conservative: a field is cleared only when the transcript
    contains no cue for it at all. Doing it the other way round — trusting the
    model and hoping — is how "300 mg, 1-0-1, after food" ends up on a
    prescription for someone who only said "take Paracetamol 3 times a day".
    """
    digits_spoken = set(re.findall(r"\d+", transcript))
    has_frequency = bool(_FREQUENCY_CUES.search(transcript))
    has_timing = bool(_TIMING_CUES.search(transcript))
    has_form = bool(_FORM_CUES.search(transcript))
    has_duration = bool(_DURATION_CUES.search(transcript))

    for med in draft.medicines:
        # A strength is only real if its number was actually said.
        if med.strength:
            strength_digits = set(re.findall(r"\d+", med.strength))
            if not strength_digits or not strength_digits.issubset(digits_spoken):
                log.info(
                    "Dropping ungrounded strength %r for %r — not in transcript.",
                    med.strength,
                    med.name,
                )
                med.strength = ""

        if med.dosage and not has_frequency:
            log.info("Dropping ungrounded dosage %r for %r.", med.dosage, med.name)
            med.dosage = ""

        if med.timing and not has_timing:
            log.info("Dropping ungrounded timing %r for %r.", med.timing, med.name)
            med.timing = ""

        if med.form and not has_form:
            log.info("Dropping ungrounded form %r for %r.", med.form, med.name)
            med.form = ""

        # Free-text instructions are where an unspoken "khane ke baad" tends to
        # reappear after being stripped from `timing`. If the dictation carries
        # no food-timing at all, an instruction asserting one is invented.
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

    # Advice is the doctor's to write (see the prompt's rule 7), but the model
    # likes to echo the dictated medicine line back into it. That is pure
    # duplication of a row the doctor is already reading, so drop any advice
    # line that just restates a prescribed medicine.
    names = [m.name.strip().lower() for m in draft.medicines if m.name.strip()]
    if names:
        kept = [
            line
            for line in draft.advice
            if not any(name in line.lower() for name in names)
        ]
        if len(kept) != len(draft.advice):
            log.info("Dropping %d advice line(s) that restate a medicine.", len(draft.advice) - len(kept))
        draft.advice = kept


@app.post("/extract-prescription", response_model=ExtractPrescriptionResponse)
async def extract_prescription(
    body: ExtractPrescriptionRequest,
) -> ExtractPrescriptionResponse:
    if not body.transcript.strip():
        raise HTTPException(422, "Transcript is empty — nothing to extract.")

    system = prescription_prompt.SYSTEM
    user = prescription_prompt.build_user(
        transcript=body.transcript,
        patient_name=body.patient.name,
        age=body.patient.age,
        gender=body.patient.gender,
        complaint=body.patient.complaint,
        medicine_catalog=body.medicine_catalog,
    )

    raw = None
    if settings.gemini_enabled and settings.gemini_api_key:
        try:
            raw = await gemini_llm.generate_json(system, user, PRESCRIPTION_JSON_SCHEMA)
        except Exception as gemini_err:
            log.warning("Gemini extraction failed (%s), falling back to local Ollama LLM.", gemini_err)

    if raw is None:
        try:
            raw = await llm.generate_json(system, user, PRESCRIPTION_JSON_SCHEMA)
        except llm.LlmError as err:
            raise HTTPException(503, str(err)) from err

    draft = DraftPrescription.model_validate(raw)

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

        med.name = speller.correct(med.name, extra=body.medicine_catalog)

    # Nothing above may invent a field. Strip any value the model supplied that
    # the doctor never spoke — the prompt forbids it, but the prompt is a
    # request, not a guarantee, and an unspoken dose reaching a prescription is
    # exactly the failure this service must not have.
    _drop_ungrounded_fields(draft, body.transcript)

    return ExtractPrescriptionResponse(
        prescription=draft,
        model_version=settings.model_version,
    )
