"""Speech-to-text, over one of two providers.

    STT_PROVIDER=sarvam    hosted Sarvam saaras (default) — sarvam_stt.py
    STT_PROVIDER=whisper   self-hosted faster-whisper   — whisper_stt.py

The public surface here is exactly what `app/transcribe.py` used to expose, so
main.py, /health, `_log_rtf` and scripts/bench_stt.py all carry on unchanged.
That last one is the point of keeping the shape: the bench script becomes an
A/B harness between the two providers for free, and the decision to keep
Sarvam should be made on its output, not on a preference.

Whisper is off, not gone. On STT_PROVIDER=sarvam its model is never
constructed — no 1GB load, no startup delay, no CPU contention with OCR — but
every line of it is still here and one env var brings it back.

Why the fallback is off by default
----------------------------------
STT_FALLBACK_TO_WHISPER exists for the case this design introduces: STT is now
a network dependency, so an outage stops transcription where before it only
made it slow. But it defaults to false, because a silent fallback would hide
exactly the Sarvam failures this phase is here to measure, and would reload the
1GB model we just stopped paying for. Turn it on deliberately, for a box that
must keep working offline.
"""

from __future__ import annotations

import logging

from ..config import settings
from . import sarvam_stt, whisper_stt

log = logging.getLogger(__name__)

# The last measured real-time factor (wall time / audio seconds), for /health.
# One number, most recent call: enough to see at a glance whether this box is
# keeping up with live speech (needs to stay well under 1.0).
_last_rtf: float | None = None


def _provider():
    return sarvam_stt if settings.stt_provider == "sarvam" else whisper_stt


def load_model() -> None:
    """Ready the selected provider. Called once on startup."""
    _provider().load_model()
    if settings.stt_provider == "sarvam" and settings.stt_fallback_to_whisper:
        # Warmed now rather than on first use: a cold Whisper load is ~20s, and
        # the moment it would be needed is the middle of a consultation, which
        # is the worst possible time to discover that.
        log.info("Fallback enabled — loading Whisper alongside Sarvam.")
        whisper_stt.load_model()


async def warm_up() -> None:
    """Pay any one-off connection cost at startup, not on the first request."""
    if settings.stt_provider == "sarvam":
        await sarvam_stt.warm_up()


async def aclose() -> None:
    if settings.stt_provider == "sarvam":
        await sarvam_stt.aclose()


def is_loaded() -> bool:
    return _provider().is_loaded()


def record_rtf(rtf: float) -> None:
    global _last_rtf
    _last_rtf = rtf


def last_rtf() -> float | None:
    return _last_rtf


async def atranscribe(
    audio: bytes,
    medicine_catalog: list[str] | None = None,
    previous_text: str | None = None,
    filename: str = "audio.wav",
) -> tuple[str, str, float, str]:
    """Transcribe audio in memory. Returns (text, language, duration, provider).

    The route main.py uses. Nothing is written to disk on the Sarvam path: the
    bytes go from the upload straight into the request body.
    """
    if settings.stt_provider != "sarvam":
        # Whisper needs a path, and blocks. main.py handles that case itself so
        # it can keep the temp file on the one path that needs it.
        raise RuntimeError("atranscribe is the Sarvam path; use transcribe() for Whisper.")

    try:
        text, language, duration = await sarvam_stt.atranscribe(
            audio, medicine_catalog, previous_text, filename
        )
        return text, language, duration, "sarvam"
    except Exception as err:
        if not settings.stt_fallback_to_whisper:
            raise
        # Named in the log, always. A fallback that does not say why it
        # happened turns a provider outage into a mystery slowdown.
        log.warning("Sarvam failed, falling back to Whisper: %s", err)
        text, language, duration = _whisper_from_bytes(
            audio, medicine_catalog, previous_text, filename
        )
        # Named as Whisper, because Whisper is what produced this text.
        return text, language, duration, "whisper"


def _whisper_from_bytes(
    audio: bytes,
    medicine_catalog: list[str] | None,
    previous_text: str | None,
    filename: str,
) -> tuple[str, str, float]:
    import os
    import tempfile

    if not whisper_stt.is_loaded():
        whisper_stt.load_model()
    suffix = os.path.splitext(filename)[1] or ".wav"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(audio)
        return whisper_stt.transcribe(path, medicine_catalog, previous_text)
    finally:
        os.unlink(path)


def transcribe(
    audio_path: str,
    medicine_catalog: list[str] | None = None,
    previous_text: str | None = None,
) -> tuple[str, str, float]:
    """Blocking, path-taking form. Kept for scripts/bench_stt.py."""
    return _provider().transcribe(audio_path, medicine_catalog, previous_text)
