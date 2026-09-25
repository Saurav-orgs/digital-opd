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


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class Settings:
    # ── Service ──────────────────────────────────────────────
    host: str = os.environ.get("AI_HOST", "127.0.0.1")
    port: int = _int("AI_PORT", 8000)

    # ── Speech-to-text: which provider ───────────────────────
    # "sarvam" (default) calls Sarvam's hosted saaras model; "whisper" runs the
    # self-hosted faster-whisper below. Whisper is off, not removed — every
    # line of it is still in app/stt/whisper_stt.py and this one value brings
    # it back. On "sarvam" the Whisper model is never constructed at all, so
    # the service starts instantly and gives up ~1GB of RAM.
    stt_provider: str = os.environ.get("STT_PROVIDER", "sarvam").strip().lower()

    # ── Sarvam (hosted STT) ──────────────────────────────────
    sarvam_api_key: str = os.environ.get("SARVAM_API_KEY", "")
    # saarika:* are all deprecated; saaras:v4 is the current model and the only
    # one that accepts `keyterms`.
    sarvam_model: str = os.environ.get("SARVAM_MODEL", "saaras:v4")
    # "translit" is the one mode that returns Roman script AND keeps the
    # doctor's own Hinglish — which is the contract the whole downstream chain
    # was written against. "verbatim" silently translates to English and
    # "transcribe" returns Devanagari; both quietly break things further down.
    # See app/stt/sarvam_stt.py for the measurements behind this.
    sarvam_mode: str = os.environ.get("SARVAM_MODE", "translit")
    # "unknown" lets Sarvam detect the language, which is what code-switched
    # Hinglish needs. Measured against a pinned "hi-IN" on 7s of dictation:
    # 0.56-0.62s either way, so auto-detect costs nothing here.
    sarvam_language: str = os.environ.get("SARVAM_LANGUAGE", "unknown")
    sarvam_timeout_seconds: int = _int("SARVAM_TIMEOUT_SECONDS", 20)
    # Sarvam prices speech-to-text at ₹30 per hour of audio, billed per second
    # (docs.sarvam.ai pricing, Sep 2026). Billed per second is what makes a
    # per-prescription figure meaningful at all: a 90-second consultation is
    # charged as 90 seconds, not as an hour or a call.
    #
    # Kept in rupees because that is the currency Sarvam actually bills in;
    # the USD figure in the cost log is derived from it, not the other way
    # round, so a change in the exchange rate cannot silently rewrite history.
    sarvam_inr_per_hour: float = _float("SARVAM_INR_PER_HOUR", 30.0)
    # Diarization is ₹45/hour, but we do not ask for it.

    # Only for the USD column in the cost log, so Sarvam and the (USD-priced)
    # LLM calls can be added together. The rupee figures never pass through it.
    usd_inr_rate: float = _float("USD_INR_RATE", 89.0)
    # How many transcriptions may be in flight. This is a network call, not a
    # CPU one, so the Whisper pool size (default 1) is exactly the wrong bound:
    # left at 1 it would serialise every doctor, and every chunk, behind one
    # HTTP request and undo the reason for moving to a hosted model at all.
    sarvam_concurrency: int = _int("SARVAM_CONCURRENCY", 8)

    # Fall back to Whisper when Sarvam fails. Off by default: a silent fallback
    # hides the provider failures this phase exists to measure, and reloads the
    # 1GB model we just stopped paying for. Turn it on for a box that has to
    # keep working without a network.
    stt_fallback_to_whisper: bool = os.environ.get(
        "STT_FALLBACK_TO_WHISPER", "false"
    ).lower() in ("1", "true", "yes")

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
    # Free tier bills nothing, so a real spend total must not count Gemini
    # calls — but the tokens are still worth costing, because the question
    # before moving to a paid key is "what would this have cost". The cost log
    # records both: `cost_usd` 0 while this is true, `would_cost_usd` always.
    gemini_free_tier: bool = os.environ.get("GEMINI_FREE_TIER", "true").lower() in ("1", "true", "yes")
    # How much Gemini may think before answering. Thinking tokens bill at the
    # OUTPUT rate, so on a reasoning model they can cost more than the answer:
    # measured at 61% of a prescription call and ~70% of a 3.5-flash report.
    #
    #   "auto" / blank  leave it to the model (dynamic thinking) — the default
    #   "0"             off; the model answers directly
    #   a positive int  a token ceiling on thinking
    #
    # Off is not automatically worse. On 3.5-flash a report came back with a
    # LONGER summary and more findings with thinking off, because the budget
    # went into writing instead. Measure the route before deciding.
    gemini_thinking_budget_raw: str = os.environ.get("GEMINI_THINKING_BUDGET", "auto")

    @property
    def gemini_thinking_budget(self) -> int | None:
        """The configured budget, or None to let the model decide."""
        raw = (self.gemini_thinking_budget_raw or "").strip().lower()
        if raw in ("", "auto", "default", "dynamic"):
            return None
        try:
            return int(raw)
        except ValueError:
            return None

    # ── Cost log ─────────────────────────────────────────────
    # Every billable Claude call appended as one JSON line, so spend can be
    # totalled per route and per model after the fact. The INFO log already
    # carries the same numbers, but it rotates, interleaves with everything
    # else, and cannot be summed — which is no use when the question is
    # "what does a report actually cost on this model".
    #
    # Relative paths resolve against the service directory. Blank disables it.
    cost_log_path: str = os.environ.get("AI_COST_LOG_PATH", "data/cost-log.jsonl")

    # ── OCR ──────────────────────────────────────────────────
    # Indian lab reports are usually phone photos, so Hindi + English together.
    ocr_languages: str = os.environ.get("OCR_LANGUAGES", "eng+hin")

    # Guard against a pathological report blowing up the context window.
    max_document_chars: int = _int("MAX_DOCUMENT_CHARS", 150000)

    # ── Local model on the clinical narrative routes ─────────
    # Off by default. The local 3B model is the last link in the chain for
    # report summaries, consolidation and progress notes, and on 2026-09-25 it
    # wrote "results are within normal limits for most parameters, indicating a
    # stable health status" for a report carrying 27 abnormal values — including
    # a ferritin of 9.90 it called normal. contradiction_guard did not catch it:
    # the claim said "most", not "all", and panel-scoped normality claims are
    # deliberately allowed.
    #
    # A summary that a doctor cannot distinguish from a correct one, and which
    # says a sick patient is well, is worse than no summary. With this false the
    # request fails loudly instead, and the doctor opens the report themselves.
    #
    # Prescription extraction is deliberately NOT gated by this: that route has
    # regex grounding guards written for exactly this model, and a drafted
    # prescription is reviewed on screen before it is signed.
    allow_local_narrative: bool = os.environ.get(
        "ALLOW_LOCAL_NARRATIVE", "false"
    ).lower() in ("1", "true", "yes")

    @property
    def active_stt_model(self) -> str:
        """The speech model that will actually serve a request."""
        return self.sarvam_model if self.stt_provider == "sarvam" else self.whisper_model

    @property
    def stt_concurrency(self) -> int:
        """How many transcriptions may run at once, as the provider requires.

        Whisper is bounded by how many model objects are held, because one
        cannot take concurrent calls. Sarvam is bounded by nothing local — the
        limit is politeness toward the API, not a property of this box.
        """
        if self.stt_provider == "sarvam":
            return max(1, self.sarvam_concurrency)
        return max(1, self.whisper_pool_size)

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

    def model_version_for(self, stt_provider: str) -> str:
        """Like `model_version`, but naming the provider that actually served.

        Not the same thing as the configured one: with
        STT_FALLBACK_TO_WHISPER on, a Sarvam outage means Whisper produced the
        text while the settings still say "sarvam". A stored row that names
        the wrong model is worse than one that names none, because it will be
        believed.
        """
        model = self.sarvam_model if stt_provider == "sarvam" else self.whisper_model
        return f"stt:{stt_provider}:{model}|rx:{self.active_llm}"

    @property
    def model_version(self) -> str:
        """Stamped onto every AI output so stored results stay traceable.

        Names the STT provider as well as the model now that there are two of
        them: "whisper:small" and "sarvam:saaras:v4" are not comparable, and a
        stored row that does not say which one produced it cannot be read back
        honestly. The backend only ever stores this string; nothing parses it.
        """
        return f"stt:{self.stt_provider}:{self.active_stt_model}|rx:{self.active_llm}"


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

# Same failure shape, one service over: STT_PROVIDER=sarvam with no key boots
# perfectly happily and then 503s every single consultation. The key belongs in
# ai-OPD/.env — the backend never transcribes, it forwards audio here, so a key
# sitting in backend-OPD/.env is invisible to the only process that calls the
# API. Checked here so main.py can say it at startup rather than at 9am.
_STT_CONFIG_ERROR: str | None = None
if settings.stt_provider not in ("sarvam", "whisper"):
    _STT_CONFIG_ERROR = (
        f"STT_PROVIDER={settings.stt_provider!r} is not a provider "
        "(expected 'sarvam' or 'whisper') — falling back to Whisper."
    )
    settings.stt_provider = "whisper"
elif settings.stt_provider == "sarvam" and not settings.sarvam_api_key:
    _STT_CONFIG_ERROR = (
        "STT_PROVIDER=sarvam but SARVAM_API_KEY is empty — every transcription "
        "will fail. Set it in ai-OPD/.env, or set STT_PROVIDER=whisper."
    )
