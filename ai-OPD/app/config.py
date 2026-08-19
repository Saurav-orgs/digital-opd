"""Runtime configuration, all environment-driven.

Every model choice is an env var so the same code runs on this laptop (small
models, CPU/Metal) and on a GPU box later (larger models) with no edits.
"""

import os


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
    # Hinglish: Whisper handles code-switching best when told the base language.
    whisper_language: str = os.environ.get("WHISPER_LANGUAGE", "hi")

    # ── LLM (Ollama) ─────────────────────────────────────────
    ollama_url: str = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    llm_model: str = os.environ.get("LLM_MODEL", "qwen2.5:3b-instruct")
    llm_timeout_seconds: int = _int("LLM_TIMEOUT_SECONDS", 300)

    # Optional LoRA adapter produced by finetune/train_lora.py. When set, the
    # served model is the fine-tuned one; unset falls back to the base model.
    lora_adapter_path: str = os.environ.get("LORA_ADAPTER_PATH", "")

    # ── OCR ──────────────────────────────────────────────────
    # Indian lab reports are usually phone photos, so Hindi + English together.
    ocr_languages: str = os.environ.get("OCR_LANGUAGES", "eng+hin")

    # Guard against a pathological report blowing up the context window.
    max_document_chars: int = _int("MAX_DOCUMENT_CHARS", 24000)

    @property
    def model_version(self) -> str:
        """Stamped onto every AI output so stored results stay traceable."""
        adapter = "+lora" if self.lora_adapter_path else ""
        return f"whisper:{self.whisper_model}|llm:{self.llm_model}{adapter}"


settings = Settings()
