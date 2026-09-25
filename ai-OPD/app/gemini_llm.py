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
import time
from typing import Any

from . import cost_log
from .config import settings

log = logging.getLogger(__name__)


class GeminiError(RuntimeError):
    """Raised when the Gemini API is unreachable or returns unusable output."""


# Published per-MTok rates for the paid tier (text input, output). Free-tier
# calls bill nothing; these exist so the log can answer "what would this have
# cost on a paid key" before anyone switches to one.
# Source: ai.google.dev/gemini-api/docs/pricing (checked 2026-09-24).
#
# The 3.6/3.7/3.8 Flash rates below are promotional and DOUBLE on 2027-01-01
# ($0.75/$3.75 -> $1.50/$7.50). Anything planned on these numbers past this
# year is planned on half the real price — see _PROMO_ENDS.
_RATES: dict[str, tuple[float, float]] = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.7-flash": (0.75, 3.75),
    "gemini-3.6-flash": (0.75, 3.75),
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3-flash": (0.50, 3.00),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.0-flash": (0.10, 0.40),
}
# After this date the three promotional rows above bill at 2x.
_PROMO_ENDS = "2027-01-01"
_PROMO_MODELS = ("gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash")


def _rates(model: str) -> tuple[float, float] | None:
    match = max((k for k in _RATES if model.startswith(k)), key=len, default="")
    return _RATES.get(match)


def _log_usage(model: str, route: str, response: Any, elapsed: float,
               budget: int | None = None) -> None:
    """Record what the call used, and what it would cost on a paid key.

    Gemini reports usage the same way on the free tier as on a paid one, so
    the only thing a free key changes is whether the money is real — which is
    why `cost_usd` and `would_cost_usd` are separate fields rather than one.
    """
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return

    def _n(field: str) -> int:
        value = getattr(usage, field, 0) or 0
        return int(value) if isinstance(value, (int, float)) else 0

    fresh = _n("prompt_token_count")
    out = _n("candidates_token_count")
    cached = _n("cached_content_token_count")
    thoughts = _n("thoughts_token_count")

    rates = _rates(model)
    in_rate, out_rate = rates or (0.0, 0.0)
    # Thinking tokens bill as output on the 2.5 models, and on a reasoning
    # model they can outweigh the visible answer — a total without them reads
    # far too low.
    would = (fresh * in_rate + (out + thoughts) * out_rate) / 1_000_000

    # Recorded alongside, not instead of: a log that quietly switched rates on
    # New Year's Day would make every comparison across that boundary wrong.
    promo = model.startswith(_PROMO_MODELS)
    would_2027 = would * 2 if promo else would

    cost_log.record(
        route=route,
        provider="gemini",
        model=model,
        input_tokens=fresh,
        cache_read_tokens=cached,
        output_tokens=out,
        thinking_tokens=thoughts,
        cost_usd=0.0 if settings.gemini_free_tier else round(would, 6),
        would_cost_usd=round(would, 6),
        would_cost_2027_usd=round(would_2027, 6),
        promo_rate=promo,
        free_tier=settings.gemini_free_tier,
        thinking_budget="auto" if budget is None else budget,
        elapsed_seconds=round(elapsed, 2),
        priced=rates is not None,
    )

    log.info(
        "Gemini %s route=%s budget=%s: in=%d cached=%d out=%d thinking=%d "
        "would_cost=$%.5f%s in %.1fs",
        model, route, "auto" if budget is None else budget,
        fresh, cached, out, thoughts, would,
        " (free tier)" if settings.gemini_free_tier else "", elapsed,
    )


async def generate_json(
    system: str,
    user: str,
    schema: dict[str, Any],  # noqa: ARG001 — kept for interface parity with llm.py
    *,
    route: str = "llm",
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

    # Passing thinking_config at all changes behaviour, so it is only included
    # when a budget is actually configured — an unset knob leaves the request
    # byte-identical to what it was before this option existed.
    budget = settings.gemini_thinking_budget
    config_kw: dict[str, Any] = dict(
        system_instruction=system,
        response_mime_type="application/json",
        temperature=0,
    )
    if budget is not None:
        config_kw["thinking_config"] = gtypes.ThinkingConfig(thinking_budget=budget)

    started = time.monotonic()
    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=user,
            config=gtypes.GenerateContentConfig(**config_kw),
        )
    except Exception as err:
        raise GeminiError(f"Gemini API call failed: {err}") from err

    _log_usage(settings.gemini_model, route, response,
                time.monotonic() - started, budget)

    text = (response.text or "").strip()
    if not text:
        raise GeminiError("Gemini returned an empty response.")

    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        log.error("Gemini output failed to parse as JSON: %s", text[:500])
        raise GeminiError(f"Gemini produced invalid JSON: {err}") from err
