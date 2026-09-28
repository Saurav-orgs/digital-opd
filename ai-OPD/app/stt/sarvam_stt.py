"""Speech-to-text via Sarvam (saaras) — the default provider.

Selected with STT_PROVIDER=sarvam. Sarvam is a hosted Indian ASR service, so
unlike `whisper_stt` there is no model to load and nothing here is CPU-bound:
every millisecond is network, and the code is shaped around that.

Why `mode=translit`
-------------------
Everything downstream of this module expects Roman script. `whisper_stt`
achieves that by feeding Whisper an `initial_prompt` written in Romanized
Hinglish; Sarvam has a mode that does it natively. Measured on a code-switched
dictation ("mareez ko teen din se bukhar hai, Dolo 650, twice a day"):

    translit   Mareez ko teen din se bukhar hai, Dolo 650 ek goli twice a day...
    codemix    Patient ko teen din se bukhar hai Dolo 650 ek goli twice a day...
    transcribe मरीज को तीन दिन से बुखार है। डालोड 650 ...
    verbatim   Patient has fever for three days Dolo six fifty one tablet...

`translit` is the only one that keeps both the doctor's own words and Roman
script, so it is the default. `verbatim` is the trap: it silently translates to
English, which would quietly gut `previous_history` — a field the prompt
requires to be the doctor's words, as spoken.

One known weakness: a strength the doctor speaks in Hindi number words comes
back as words ("Dolo chheh sau pachaas"), not digits. Spoken in English inside
a Hindi sentence — how strengths are almost always dictated — digits survive.

Why `keyterms` replaces the vocabulary prompt
---------------------------------------------
Whisper is biased toward the clinic's drug names by gluing them into
`initial_prompt`. Sarvam takes them as a first-class `keyterms` list instead,
so the medicine catalogue the backend already sends on every call goes straight
through. Capped by the API at 50 terms of 64 characters.

What is NOT carried over
------------------------
`previous_text`. Whisper's chunk path feeds back the tail of the transcript so
far, so a sentence cut mid-word rejoins on the other side of the cut. Sarvam's
REST endpoint is stateless per call and has no equivalent, so the argument is
accepted and ignored. That loss is also what makes chunks independent, which is
what lets the caller put several in flight at once — a far larger win than the
context was.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import os
import time
import wave

import httpx

from .. import cost_log
from ..config import settings

log = logging.getLogger(__name__)

_ENDPOINT = "https://api.sarvam.ai/speech-to-text"

# Sarvam's synchronous endpoint is documented for audio under 30 seconds. The
# live path never comes close (segments are a few seconds), but the whole-file
# fallback carries a minute or two, so it is split below. 25s leaves headroom
# for the limit being about decoded length rather than exactly what we compute.
_MAX_AUDIO_SECONDS = 25.0

# API caps, enforced here so a long catalogue is trimmed rather than rejected.
_MAX_KEYTERMS = 50
_MAX_KEYTERM_CHARS = 64

# One client for the process. A fresh TLS handshake per chunk would cost more
# than the transcription itself (measured ~80ms of the ~600ms round trip on a
# cold connection), so the connection is opened once and kept warm.
_client: httpx.AsyncClient | None = None
_ready = False


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(
            settings.sarvam_timeout_seconds,
            # Connect gets its own, much shorter budget: a host that is not
            # answering should fail fast enough to still leave room for the
            # one retry, rather than burning the whole request timeout.
            connect=5.0,
        ),
        limits=httpx.Limits(
            max_keepalive_connections=settings.sarvam_concurrency,
            max_connections=settings.sarvam_concurrency * 2,
            # Longer than the gap between two consultations, so the second one
            # does not pay to reopen what the first one already had open.
            keepalive_expiry=300.0,
        ),
        headers={"api-subscription-key": settings.sarvam_api_key},
    )


def load_model() -> None:
    """No model to load. Opens the shared client and warms the connection."""
    global _client, _ready
    if _ready:
        return
    if not settings.sarvam_api_key:
        raise RuntimeError(
            "SARVAM_API_KEY is not set — STT_PROVIDER=sarvam cannot serve requests. "
            "Set it in ai-OPD/.env (not backend-OPD/.env: the backend never "
            "transcribes), or set STT_PROVIDER=whisper."
        )
    _client = _make_client()
    _ready = True
    log.info(
        "Sarvam STT ready (model=%s mode=%s language=%s concurrency=%d).",
        settings.sarvam_model,
        settings.sarvam_mode,
        settings.sarvam_language,
        settings.sarvam_concurrency,
    )


async def warm_up() -> None:
    """Pay DNS + TCP + TLS once, at startup, instead of on the first chunk.

    Roughly 200-400ms to an Indian endpoint from a cold process — small, but it
    lands on the first thing the doctor says, which is the worst place for it.
    Any failure here is ignored: an unreachable host at boot is not a reason to
    refuse to start, and the real request will report it properly.
    """
    if _client is None:
        return
    with contextlib.suppress(Exception):
        started = time.monotonic()
        # No transcription endpoint is free to call, so this just opens the
        # connection; a 404/405 is a perfectly good handshake.
        await _client.head(_ENDPOINT)
        log.info("Sarvam connection warm (%.0f ms).", (time.monotonic() - started) * 1000)


async def aclose() -> None:
    global _client, _ready
    if _client is not None:
        await _client.aclose()
    _client, _ready = None, False


def is_loaded() -> bool:
    return _ready


# ── audio helpers ────────────────────────────────────────────


def _wav_duration(data: bytes) -> float:
    """Length in seconds, read from the WAV header.

    Sarvam does not report how long the audio was, but `_log_rtf` and
    `TranscribeResponse.duration_seconds` both need it. Every segment from the
    browser is 16 kHz mono WAV (see admin-OPD/src/lib/audio/capture.ts), so the
    header is enough and costs nothing. Anything else returns 0.0, which
    `_log_rtf` already treats as "no RTF to report".
    """
    try:
        with contextlib.closing(wave.open(io.BytesIO(data), "rb")) as handle:
            rate = handle.getframerate()
            return handle.getnframes() / rate if rate else 0.0
    except Exception:
        return 0.0


def _split_wav(data: bytes, seconds: float = _MAX_AUDIO_SECONDS) -> list[bytes]:
    """Cut a WAV into pieces of at most `seconds`, each a complete WAV.

    Only for the whole-file fallback route, which can carry a minute or two —
    past what the synchronous endpoint accepts. Uses the stdlib `wave` module
    on purpose: splitting audio is not worth an ffmpeg dependency on every box
    that runs this service.

    Returns [data] unchanged when it is short enough or is not a WAV at all.
    """
    try:
        with contextlib.closing(wave.open(io.BytesIO(data), "rb")) as src:
            rate = src.getframerate()
            total = src.getnframes()
            if not rate or total / rate <= seconds:
                return [data]
            params = src.getparams()
            per_piece = int(rate * seconds)

            pieces: list[bytes] = []
            while src.tell() < total:
                frames = src.readframes(per_piece)
                if not frames:
                    break
                buf = io.BytesIO()
                with contextlib.closing(wave.open(buf, "wb")) as dst:
                    dst.setparams(params)
                    dst.writeframes(frames)
                pieces.append(buf.getvalue())
            return pieces or [data]
    except Exception:
        # Not a WAV (the no-AudioWorklet browser sends webm). Send it whole and
        # let Sarvam decide; a length rejection surfaces as a readable error.
        return [data]


def _keyterms(medicine_catalog: list[str] | None) -> str | None:
    if not medicine_catalog:
        return None
    terms: list[str] = []
    seen: set[str] = set()
    for name in medicine_catalog:
        clean = (name or "").strip()[:_MAX_KEYTERM_CHARS]
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            terms.append(clean)
        if len(terms) >= _MAX_KEYTERMS:
            break
    return json.dumps(terms, ensure_ascii=False) if terms else None


# ── the call ─────────────────────────────────────────────────


def _worth_retrying(err: Exception) -> bool:
    """True when the host is up but this particular call did not land.

    A 4xx is our request being wrong — sending the identical request again
    only spends the doctor's time being wrong a second time.
    """
    if isinstance(err, httpx.TransportError):
        return True
    if isinstance(err, httpx.HTTPStatusError):
        code = err.response.status_code
        return code >= 500 or code == 429
    return False


async def _post(audio: bytes, filename: str, keyterms: str | None) -> tuple[str, str]:
    """One request. Returns (transcript, language_code)."""
    if _client is None:
        raise RuntimeError("Sarvam client is not open.")

    data = {
        "model": settings.sarvam_model,
        "mode": settings.sarvam_mode,
        "language_code": settings.sarvam_language,
    }
    if keyterms:
        data["keyterms"] = keyterms

    # Deliberately no `with_timestamps`: we never read them, and asking for
    # output we discard is latency spent on nothing.
    last: Exception | None = None
    for attempt in (1, 2):
        try:
            response = await _client.post(
                _ENDPOINT,
                data=data,
                files={"file": (filename, audio, "audio/wav")},
            )
            # Retried: the host is up but this call did not land. Not retried:
            # 4xx, which is our request being wrong — a second identical one
            # would be wrong the same way, one request later.
            if response.status_code >= 500 or response.status_code == 429:
                raise httpx.HTTPStatusError(
                    f"Sarvam returned {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            body = response.json()
            return (body.get("transcript") or "").strip(), body.get("language_code") or ""
        except (httpx.TransportError, httpx.HTTPStatusError) as err:
            last = err
            # One retry, and only here. A blanket retry on a slow-but-alive
            # request would hand the doctor two full timeouts back to back;
            # one failed segment is a visible gap they can simply repeat.
            if attempt == 2 or not _worth_retrying(err):
                break
            await asyncio.sleep(0.25)
    raise RuntimeError(f"Sarvam transcription failed: {last}") from last


async def atranscribe(
    audio: bytes,
    medicine_catalog: list[str] | None = None,
    previous_text: str | None = None,
    filename: str = "audio.wav",
) -> tuple[str, str, float]:
    """Transcribe audio held in memory. Returns (text, language, duration).

    `previous_text` is accepted and ignored — see the module docstring.
    """
    if not _ready:
        raise RuntimeError("Sarvam STT is not configured.")

    duration = _wav_duration(audio)
    keyterms = _keyterms(medicine_catalog)
    started = time.monotonic()

    pieces = _split_wav(audio)
    if len(pieces) == 1:
        text, language = await _post(pieces[0], filename, keyterms)
    else:
        # The pieces do not depend on each other, so they go at once and are
        # joined by index. A two-minute recording costs one round trip, not
        # five of them end to end.
        log.info("Splitting %.0fs of audio into %d pieces.", duration, len(pieces))
        results = await asyncio.gather(
            *(_post(piece, f"{i}-{filename}", keyterms) for i, piece in enumerate(pieces))
        )
        text = " ".join(t for t, _ in results if t).strip()
        language = next((lang for _, lang in results if lang), "")

    elapsed = time.monotonic() - started
    # Network time on its own line: when this route gets slow, the next
    # question is always "was it them or us", and that needs the split.
    log.info(
        "Sarvam: %.1fs audio in %.2fs network (%d request(s), %d keyterms).",
        duration,
        elapsed,
        len(pieces),
        len(json.loads(keyterms)) if keyterms else 0,
    )
    # Billed per second of audio, so the charge is the audio length — not the
    # wall time, and not the number of requests the split turned it into.
    # Priced from `duration`, which is 0.0 for a non-WAV upload we cannot
    # measure; `priced` says which of the two happened so a total is never
    # quietly short.
    cost_inr = duration / 3600.0 * settings.sarvam_inr_per_hour
    cost_log.record(
        route="stt",
        provider="sarvam",
        model=settings.sarvam_model,
        mode=settings.sarvam_mode,
        audio_seconds=round(duration, 2),
        cost_inr=round(cost_inr, 6),
        cost_usd=round(cost_inr / settings.usd_inr_rate, 8),
        inr_per_hour=settings.sarvam_inr_per_hour,
        priced=duration > 0,
        elapsed_seconds=round(elapsed, 3),
        requests=len(pieces),
    )

    # Sarvam answers with a BCP-47 tag ("hi-IN"); the rest of the service, and
    # the stored session row, speak Whisper's bare code.
    return text, (language.split("-")[0] if language else ""), duration


# A loop of its own for the blocking wrapper below. `asyncio.run` would build
# and tear down a fresh loop per call, and the shared AsyncClient binds its
# connection pool to the loop that first used it — so the second clip in a
# bench run would be talking to a pool belonging to a closed loop. One
# long-lived loop keeps the connection warm across the whole run, which is also
# the only way the bench numbers mean anything.
_sync_loop: asyncio.AbstractEventLoop | None = None


def transcribe(
    audio_path: str,
    medicine_catalog: list[str] | None = None,
    previous_text: str | None = None,
) -> tuple[str, str, float]:
    """Blocking, path-taking form, for callers that have a file.

    The service itself never uses this — `main.py` awaits `atranscribe` with
    the bytes it already holds, so nothing touches the disk. It exists for
    `scripts/bench_stt.py`, which walks a folder of clips and is the harness
    that compares this provider against Whisper.
    """
    global _sync_loop
    with open(audio_path, "rb") as handle:
        audio = handle.read()
    if _sync_loop is None or _sync_loop.is_closed():
        _sync_loop = asyncio.new_event_loop()
    return _sync_loop.run_until_complete(
        atranscribe(audio, medicine_catalog, previous_text, os.path.basename(audio_path))
    )
