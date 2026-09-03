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
import os
import queue
from typing import Any

from .config import settings

log = logging.getLogger(__name__)

# One model object cannot serve two transcriptions at once — the CTranslate2
# state inside it is not safe for concurrent calls, which is why every
# consultation used to queue behind the one before it. With several doctors
# recording at the same time that queue, not the model, was the wait.
#
# So we hold a small pool and check a model out per request. The Queue *is* the
# checkout: get() blocks until one is free, and transcribe() already runs in a
# worker thread, so blocking here never touches the event loop. Size 1 (the
# default) behaves exactly as the single shared model did.
_pool: queue.Queue = queue.Queue()
_pool_size = 0


def load_model() -> None:
    """Load the Whisper pool. Called once on startup."""
    global _pool_size
    if _pool_size:
        return
    from faster_whisper import WhisperModel  # imported lazily: heavy

    size = max(1, settings.whisper_pool_size)
    # Threads per model, and it matters more than it looks. Measured on a
    # 20s clip, 8-core box, one model: the library's own default took 3.9s,
    # 2 and 4 threads took 2.2s, and 8 threads went back to 4.0s. Whisper
    # stops scaling a few threads in, and past that the threads mostly
    # contend — so cap at 4 and divide the rest across the pool, and never
    # hand one model the whole machine. Output is unaffected either way;
    # the transcripts came back byte-identical. WHISPER_CPU_THREADS overrides.
    threads = settings.whisper_cpu_threads or min(4, max(1, (os.cpu_count() or 1) // size))

    log.info(
        "Loading %d Whisper model(s) model=%s device=%s compute=%s cpu_threads=%d",
        size,
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
        threads,
    )
    for _ in range(size):
        _pool.put(
            WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
                cpu_threads=threads,
            )
        )
        # Counted as each one lands, so a pool that only half-loads still
        # serves on what it got instead of reporting itself ready for more.
        _pool_size += 1
    log.info("Whisper pool ready (%d model(s)).", _pool_size)


def is_loaded() -> bool:
    return _pool_size > 0


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
    if not _pool_size:
        raise RuntimeError("Whisper model is not loaded.")

    lang = settings.whisper_language.strip() if settings.whisper_language.strip() else "en"

    # Waits for a free model rather than failing when all are busy, so a third
    # doctor on a pool of two is delayed, never turned away.
    model = _pool.get()
    try:
        segments, info = model.transcribe(
            audio_path,
            language=lang,
            initial_prompt=_vocabulary_prompt(medicine_catalog),
            # VAD drops the silence between doctor and patient turns
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            # Stays at 5 — see the note in config.py. Greedy decoding halved
            # the time and dropped the dosage sentence with it.
            beam_size=settings.whisper_beam_size,
            # Only consulted on temperature fallback, so it stays at 5: when a
            # segment is hard enough to need the fallback, the extra candidates
            # are exactly what rescues it.
            best_of=5,
            condition_on_previous_text=False,
            repetition_penalty=1.2,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.2,
        )

        # `segments` is a generator — consuming it is what actually runs
        # inference, so it has to happen before the model goes back.
        text = " ".join(segment.text.strip() for segment in segments).strip()
        language, duration = info.language, float(info.duration)
    finally:
        # Returned even when inference raised; a model lost here would shrink
        # the pool permanently and eventually deadlock every transcription.
        _pool.put(model)

    return text, language, duration
