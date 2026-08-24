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


def _vocabulary_prompt(medicine_catalog: list[str] | None) -> str:
    """Bias decoding toward clinic medical vocabulary in Roman script (English & Hinglish).

    Whisper conditions on this text as if it preceded the audio, ensuring it
    transcribes in Roman script (e.g. 'thik hai, Dolo 500 kha lena subah shaam')
    and never outputs Devanagari characters or mangles medicine names.
    """
    base_terms = [
        "Doctor prescription",
        "thik hai",
        "Dolo 500",
        "Dolo 650",
        "Paracetamol 500mg",
        "Pantocid 40",
        "Pan 40",
        "Azithral 500",
        "Azithromycin 500",
        "Augmentin 625",
        "Clavam 625",
        "Montair LC",
        "Cetirizine 10mg",
        "Combiflam",
        "Meftal Spas",
        "Zerodol SP",
        "Telma 40",
        "Metformin 500",
        "Amlodipine 5mg",
        "subah shaam",
        "kha lena",
        "dopahar",
        "raat ko",
        "khana khane ke baad",
        "khali pet",
        "din mein do baar",
        "din mein teen baar",
        "5 din",
        "3 din",
        "1 hafta",
    ]
    if medicine_catalog:
        seen = set(t.lower() for t in base_terms)
        for name in medicine_catalog:
            clean = name.strip()
            if clean and clean.lower() not in seen:
                seen.add(clean.lower())
                base_terms.append(clean)

    # Keep prompt within token budget (~200 tokens)
    return ", ".join(base_terms[:45]) + "."


def transcribe(
    audio_path: str,
    medicine_catalog: list[str] | None = None,
) -> tuple[str, str, float]:
    """Transcribe an audio file. Returns (text, language, duration_seconds).

    Always transcribes in Roman script (English / Romanized Hinglish).
    """
    if _model is None:
        raise RuntimeError("Whisper model is not loaded.")

    lang = settings.whisper_language.strip() if settings.whisper_language.strip() else "en"

    segments, info = _model.transcribe(
        audio_path,
        language=lang,
        initial_prompt=_vocabulary_prompt(medicine_catalog),
        # VAD drops the silence between doctor and patient turns
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
        repetition_penalty=1.2,
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.2,
    )

    # `segments` is a generator — consuming it is what actually runs inference.
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, info.language, float(info.duration)
