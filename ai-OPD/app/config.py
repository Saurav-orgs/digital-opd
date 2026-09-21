"""Runtime configuration, all environment-driven.

Every model choice is an env var so the same code runs on this laptop (small
models, CPU/Metal) and on a GPU box later (larger models) with no edits.
"""

import os
import pathlib

# Nothing was reading .env before — config.py went straight to os.environ, so a
# key written into the file never reached the process and the service quietly
# ran on whatever the defaults were. Loading it here makes the file mean what
# it looks like it means.
#
# override=False on purpose: a real environment variable (Docker -e, systemd,
# Kubernetes) still beats the file, so deployments are not surprised by a
# stray .env sitting in the image.
try:
    from dotenv import load_dotenv

    load_dotenv(pathlib.Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:  # python-dotenv absent: fall back to the real environment
    pass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class Settings:
    # ── Service ──────────────────────────────────────────────
    host: str = os.environ.get("AI_HOST", "127.0.0.1")
    port: int = _int("AI_PORT", 8000)

    # ── Speech-to-text (faster-whisper) ──────────────────────
    # A Hindi fine-tuned checkpoint beats stock Whisper on Indian speech.
    # Alternatives: "vasista22/whisper-hindi-medium", "ai4bharat/indicwhisper",
    # or a plain size ("small"/"medium") for multilingual Hinglish.
    whisper_model: str = os.environ.get("WHISPER_MODEL", "small")
    # int8 keeps the M1 fast and the memory footprint low; use float16 on a GPU.
    whisper_compute_type: str = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
    whisper_device: str = os.environ.get("WHISPER_DEVICE", "cpu")
    # Multilingual: Whisper handles Indian English + Hindi code-switching best when
    # language is left to auto-detect with a rich medical prompt.
    whisper_language: str = os.environ.get("WHISPER_LANGUAGE", "")

    # How many Whisper models to hold, i.e. how many consultations can transcribe
    # at once. 1 keeps the original behaviour exactly: one at a time, everyone
    # else queued. Raise it on a multi-doctor box — each model is a further
    # ~1GB of RAM and wants its own core or two, so 2-3 on a 4-8 core server.
    whisper_pool_size: int = _int("WHISPER_POOL_SIZE", 1)
    # Threads per model. 0 divides the box's cores across the pool, which is
    # what you want; set it only to override that.
    whisper_cpu_threads: int = _int("WHISPER_CPU_THREADS", 0)
    # Left at 5 deliberately. Greedy (1) is twice as fast, but measured on
    # dictated prescription audio it silently dropped the entire dosage
    # sentence — "Patient has fever since 3 days." and nothing after it. A
    # transcript that loses the medicine is worse than a slow one, and 2 buys
    # back the text for only ~10% off 5, so there is no speed here worth
    # taking. Exposed as an env var so it can be measured again, not tuned.
    whisper_beam_size: int = _int("WHISPER_BEAM_SIZE", 5)
    # Batched decoding: faster-whisper's BatchedInferencePipeline splits the
    # audio on silence and decodes the pieces in parallel instead of one
    # segment after another. Same model, same weights — 2-4x faster on the
    # same box. Off by default until it has been measured against the plain
    # path on this hardware (scripts/bench_stt.py), because the beam-size
    # measurement in the note above was taken on the sequential path.
    whisper_batched: bool = os.environ.get("WHISPER_BATCHED", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    whisper_batch_size: int = _int("WHISPER_BATCH_SIZE", 8)

    # ── LLM (Ollama) ─────────────────────────────────────────
    # Ollama is the last-resort fallback, not a requirement. A deployment that
    # runs on Claude has no reason to install it, and setting this false says
    # so out loud: /health stops probing for it and stops calling the service
    # degraded over its absence, and the fallback chain skips it with a message
    # that names the real problem instead of "connection refused".
    local_llm_enabled: bool = os.environ.get("LOCAL_LLM_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    ollama_url: str = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    llm_model: str = os.environ.get("LLM_MODEL", "qwen2.5:3b-instruct")
    llm_timeout_seconds: int = _int("LLM_TIMEOUT_SECONDS", 300)

    # Optional LoRA adapter produced by finetune/train_lora.py. When set, the
    # served model is the fine-tuned one; unset falls back to the base model.
    lora_adapter_path: str = os.environ.get("LORA_ADAPTER_PATH", "")

    # ── Claude (Anthropic) ───────────────────────────────────
    # First choice for every LLM call when a key is present: prescription
    # extraction and all three summary endpoints. Gemini and the local Ollama
    # model stay wired underneath, so an outage degrades instead of failing.
    claude_enabled: bool = os.environ.get("AI_CLAUDE_ENABLED", "true").lower() in ("1", "true", "yes")
    claude_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    claude_model: str = os.environ.get("AI_CLAUDE_MODEL", "claude-opus-5")
    # How much the model thinks before answering. "high" because capturing
    # everything the doctor said matters more here than a couple of seconds;
    # drop to "medium" or "low" if extraction feels slow in clinic.
    #
    # AI_-prefixed on purpose: a bare CLAUDE_EFFORT collides with a variable
    # Claude Code exports, and load_dotenv(override=False) lets the real
    # environment win — so the file said "medium" while the service ran "high".
    claude_effort: str = os.environ.get("AI_CLAUDE_EFFORT", "high")
    # Identity-linked API keys must name the workspace the request acts in, or
    # every call returns 400. Console -> Settings -> Workspaces; the id looks
    # like wrkspc_... . Blank is fine for a plain (non-identity-linked) key.
    claude_workspace_id: str = os.environ.get(
        "ANTHROPIC_WORKSPACE_ID", os.environ.get("AI_CLAUDE_WORKSPACE_ID", "")
    )
    claude_timeout_seconds: int = _int("AI_CLAUDE_TIMEOUT_SECONDS", 120)
    claude_max_tokens: int = _int("AI_CLAUDE_MAX_TOKENS", 8000)

    # ── Claude: prescription extraction only ─────────────────
    # The one call a doctor waits on with a patient in the room. It is a
    # narrow, schema-constrained extraction from a minute or two of speech,
    # so it does not need what the summaries need, and every second here is
    # felt. Each knob is separate from the summary settings so that speeding
    # this route up never touches the reports.
    #
    # Effort: "medium" by default — measured against "high" on stored
    # transcripts with scripts/bench_extract.py before changing it.
    claude_extract_effort: str = os.environ.get("AI_CLAUDE_EXTRACT_EFFORT", "medium")
    # Model: blank means the same model as everything else. Set e.g.
    # "claude-sonnet-5" to A/B a faster model on this route alone.
    claude_extract_model: str = os.environ.get("AI_CLAUDE_EXTRACT_MODEL", "")
    # A draft is a few hundred tokens; 8000 only ever bounds a runaway.
    claude_extract_max_tokens: int = _int("AI_CLAUDE_EXTRACT_MAX_TOKENS", 4000)
    # Fast mode: the same Opus model served at up to ~2.5x the output speed,
    # at premium pricing. Opus-only; silently ignored on any other model.
    # Off by default — turn on when the measured draft time matters more
    # than the per-call price.
    claude_fast: bool = os.environ.get("AI_CLAUDE_FAST", "false").lower() in (
        "1",
        "true",
        "yes",
    )

    # ── Gemini (prescription extraction only) ────────────────
    # When true, /extract-prescription uses Gemini (with automatic Ollama fallback).
    # All other endpoints (report summaries, transcription) always use local models.
    gemini_enabled: bool = os.environ.get("GEMINI_ENABLED", "true").lower() in ("1", "true", "yes")
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    # ── OCR ──────────────────────────────────────────────────
    # Indian lab reports are usually phone photos, so Hindi + English together.
    ocr_languages: str = os.environ.get("OCR_LANGUAGES", "eng+hin")

    # Guard against a pathological report blowing up the context window.
    max_document_chars: int = _int("MAX_DOCUMENT_CHARS", 150000)

    @property
    def cloud_llm_configured(self) -> bool:
        """True when a hosted backend can serve LLM calls on its own.

        The question /health actually needs to answer is "can this service run
        an LLM request", which used to be asked as "is Ollama up" — so a box
        deliberately running on Claude reported itself degraded forever.
        """
        return bool(
            (self.claude_enabled and self.claude_api_key)
            or (self.gemini_enabled and self.gemini_api_key)
        )

    @property
    def active_llm(self) -> str:
        """The backend a request will be offered to first.

        Reflects intent, not outcome: a call that falls through to Gemini or
        Ollama is still stamped with the backend that was tried first. The
        fallback itself is logged, so the two together tell the whole story.
        """
        if self.claude_enabled and self.claude_api_key:
            # Stamped onto prescription drafts, so it names the model that
            # drafts them — which may not be the one the summaries use.
            return self.claude_extract_model or self.claude_model
        if self.gemini_enabled and self.gemini_api_key:
            return self.gemini_model
        adapter = "+lora" if self.lora_adapter_path else ""
        return f"{self.llm_model}{adapter}"

    @property
    def model_version(self) -> str:
        """Stamped onto every AI output so stored results stay traceable."""
        return f"whisper:{self.whisper_model}|rx:{self.active_llm}"


settings = Settings()

# The Claude keys were renamed with an AI_ prefix (see claude_effort above).
# A .env still carrying the old names is not an error the process can see —
# it just runs on the defaults while the file says otherwise, which is exactly
# how the service spent weeks at effort "high" believing it was on "medium".
# Say so at startup, loudly.
_LEGACY_CLAUDE_KEYS = [
    key
    for key in ("CLAUDE_ENABLED", "CLAUDE_MODEL", "CLAUDE_EFFORT", "CLAUDE_TIMEOUT_SECONDS", "CLAUDE_MAX_TOKENS")
    if key in os.environ and f"AI_{key}" not in os.environ
]
