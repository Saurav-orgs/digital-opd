"""Speech-to-text via faster-whisper.

The model is loaded once at startup (loading costs seconds and several hundred
MB, so per-request loading would make every consultation unusable).

Two things do most of the accuracy work here, neither of which is training:
  1. a Hindi fine-tuned checkpoint, set via WHISPER_MODEL;
  2. `initial_prompt` carrying the clinic's medicine names, which biases decoding
     toward the drug names this doctor actually prescribes.
"""

from __future__ import annotations

import logging
from typing import Any

from .config import settings

log = logging.getLogger(__name__)

_model: Any = None


def load_model() -> None:
    """Load the Whisper model. Called once on startup."""
    global _model
    if _model is not None:
        return
    from faster_whisper import WhisperModel  # imported lazily: heavy

    log.info(
        "Loading Whisper model=%s device=%s compute=%s",
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    _model = WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )
    log.info("Whisper model ready.")


def is_loaded() -> bool:
    return _model is not None


def _vocabulary_prompt(medicine_catalog: list[str] | None) -> str | None:
    """Bias decoding toward clinic vocabulary.

    Whisper conditions on this text as if it preceded the audio, so listing the
    medicine names makes it far likelier to transcribe them correctly instead of
    an acoustically similar everyday word.
    """
    if not medicine_catalog:
        return None
    # Whisper only conditions on the last ~224 tokens, so a long catalogue is
    # counterproductive — keep the most-used names.
    names = ", ".join(medicine_catalog[:60])
    return f"Medical consultation. Medicines discussed may include: {names}."


def transcribe(
    audio_path: str,
    medicine_catalog: list[str] | None = None,
) -> tuple[str, str, float]:
    """Transcribe an audio file. Returns (text, language, duration_seconds)."""
    if _model is None:
        raise RuntimeError("Whisper model is not loaded.")

    segments, info = _model.transcribe(
        audio_path,
        language=settings.whisper_language or None,
        initial_prompt=_vocabulary_prompt(medicine_catalog),
        # VAD drops the silence between doctor and patient turns, which on a
        # long consultation is a large share of the audio.
        vad_filter=True,
        beam_size=5,
    )

    # `segments` is a generator — consuming it is what actually runs inference.
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, info.language, float(info.duration)
