"""Gemini API client — the hosted fallback behind Claude, and the imaging reader.

Same `generate_json(system, user, schema)` / `generate_json_from_image(...)`
signatures as claude_llm.py, so `llm_chain` can walk from one to the other
without knowing anything about the provider behind either.

Two things worth knowing about this backend:

  1. Structured outputs. `response_json_schema` constrains the reply to the
     schema the same way Claude's `output_config.format` does. Plain JSON mode
     (`response_mime_type` alone) only promises *valid* JSON, not JSON of the
     right shape — which is not enough for the imaging route, where the prompt
     describes the fields in prose and nothing else would hold the model to
     them.
  2. Images. Gemini reads a picture of a report — an X-ray film, an ECG strip
     — so a clinic running without an Anthropic key still gets a first read
     instead of "could not be read".

Raising GeminiError rather than retrying here is deliberate: `llm_chain` has
the local model underneath, so an outage or a refusal walks down that chain
instead of failing the consultation.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from . import cost_log
from .config import settings

log = logging.getLogger(__name__)

_client: Any = None


class GeminiError(RuntimeError):
    """Raised when the Gemini API is unreachable or returns unusable output."""


# ── Usage and cost accounting ────────────────────────────────
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


def _get_client() -> Any:
    """One client for the process — it holds a connection pool worth reusing.

    A fresh `genai.Client` per call was a new TLS handshake on every
    prescription, on the one route a doctor waits on with a patient in front
    of them.
    """
    global _client
    if _client is not None:
        return _client

    try:
        from google import genai
    except ImportError as err:
        raise GeminiError(
            "google-genai is not installed. Run: pip install google-genai"
        ) from err

    if not settings.gemini_api_key:
        raise GeminiError("GEMINI_API_KEY is not set.")

    _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _config(system: str, schema: dict[str, Any] | None) -> tuple[Any, int | None]:
    """The generation config shared by the text and image calls, and its budget.

    The budget is handed back rather than re-read because the cost log records
    what the call actually asked for, and `settings` could be read twice with
    two different answers.
    """
    from google.genai import types as gtypes

    kw: dict[str, Any] = dict(
        system_instruction=system,
        response_mime_type="application/json",
        temperature=0,
    )
    # Constrains the reply to the schema rather than merely to valid JSON.
    # The imaging route depends on it — its prompt names the fields in prose,
    # and nothing else would hold the model to them.
    if schema:
        kw["response_json_schema"] = schema

    # Passing thinking_config at all changes behaviour, so it is only included
    # when a budget is actually configured — an unset knob leaves the request
    # byte-identical to what it was before this option existed.
    budget = settings.gemini_thinking_budget
    if budget is not None:
        kw["thinking_config"] = gtypes.ThinkingConfig(thinking_budget=budget)

    return gtypes.GenerateContentConfig(**kw), budget


async def _generate(
    system: str,
    contents: Any,
    schema: dict[str, Any] | None,
    route: str,
) -> dict[str, Any]:
    """One Gemini call: send, cost, parse. The only place any of that happens.

    `contents` is whatever the caller assembled — a string for the text
    routes, or a list of parts when there is an image in front of the
    instruction.
    """
    client = _get_client()
    config, budget = _config(system, schema)

    started = time.monotonic()
    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=config,
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


async def generate_json(
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    route: str = "llm",
) -> dict[str, Any]:
    """Run a completion whose output is constrained to `schema`."""
    return await _generate(system, user, schema, route)


async def generate_json_from_image(
    system: str,
    user: str,
    image: bytes,
    media_type: str,
    schema: dict[str, Any],
    *,
    route: str = "llm-image",
) -> dict[str, Any]:
    """`generate_json`, with an image in the user turn.

    For reports that are pictures rather than text — an X-ray film, an ECG
    strip, a scan — where OCR has nothing to give the text path. The image
    goes first and the instruction after it, which is the order the model
    reads best, and the same order claude_llm uses.
    """
    from google.genai import types as gtypes

    parts = [gtypes.Part.from_bytes(data=image, mime_type=media_type), user]
    return await _generate(system, parts, schema, route)
