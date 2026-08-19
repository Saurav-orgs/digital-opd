"""Gemini API client for prescription extraction.

Same interface as llm.py (generate_json) so main.py can swap backends with a
single flag. Only called when GEMINI_ENABLED=true; the google-genai package
must be installed (added to requirements.txt).

Only /extract-prescription routes here — report summaries and transcription
always use the local Ollama/Whisper stack.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .config import settings

log = logging.getLogger(__name__)


class GeminiError(RuntimeError):
    """Raised when the Gemini API is unreachable or returns unusable output."""


async def generate_json(
    system: str,
    user: str,
    schema: dict[str, Any],  # noqa: ARG001 — kept for interface parity with llm.py
) -> dict[str, Any]:
    """Call Gemini and return a parsed JSON dict.

    Uses JSON mode (response_mime_type='application/json') rather than the
    schema-constrained decoding Ollama offers, so the prompt must be explicit
    enough that the model returns the right shape. The schema arg is accepted
    but unused — validation happens on the Python side via Pydantic.
    """
    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError as err:
        raise GeminiError(
            "google-genai is not installed. Run: pip install google-genai"
        ) from err

    if not settings.gemini_api_key:
        raise GeminiError("GEMINI_API_KEY is not set.")

    client = genai.Client(api_key=settings.gemini_api_key)

    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=user,
            config=gtypes.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0,
            ),
        )
    except Exception as err:
        raise GeminiError(f"Gemini API call failed: {err}") from err

    text = (response.text or "").strip()
    if not text:
        raise GeminiError("Gemini returned an empty response.")

    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        log.error("Gemini output failed to parse as JSON: %s", text[:500])
        raise GeminiError(f"Gemini produced invalid JSON: {err}") from err
