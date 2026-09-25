"""Anthropic Claude client — first choice for every LLM call when a key is set.

Same `generate_json(system, user, schema)` signature as llm.py and
gemini_llm.py, so main.py swaps backends without knowing anything about the
provider behind one.

Two things here the other two backends cannot do, and that the voice
prescription depends on:

  1. Structured outputs. `output_config.format` constrains the response to the
     JSON schema the same way Ollama's `format` does, so "the model returned
     prose instead of JSON" stops being a failure mode. Gemini's JSON mode only
     promises *valid* JSON, not JSON of the right shape.
  2. Prompt caching. The system prompt is ~1.8k tokens and byte-identical on
     every request, so it is marked cacheable and read back at a tenth of the
     input price. It clears the ~1024-token minimum comfortably. The medicine
     catalogue sits in the user message and varies per clinic, so it is
     deliberately left outside the cached prefix.

Raising ClaudeError rather than retrying here is deliberate: main.py already
has a Gemini → Ollama chain underneath, so an outage, a rate limit or a refusal
walks down that chain instead of failing the consultation.
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


# ── Usage and cost accounting ────────────────────────────────
# Published per-MTok rates (input, output, cache-read, cache-write). Cache
# writes bill at 1.25x input, cache reads at 0.1x. Longest matching prefix
# wins, so a dated or suffixed id still lands on the right row.
_RATES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-opus-5": (5.00, 25.00, 0.50, 6.25),
    "claude-opus-4": (5.00, 25.00, 0.50, 6.25),
    "claude-sonnet-5": (2.00, 10.00, 0.20, 2.50),
    "claude-sonnet-4": (3.00, 15.00, 0.30, 3.75),
    "claude-haiku-4-5": (1.00, 5.00, 0.10, 1.25),
    "claude-fable-5": (10.00, 50.00, 0.25, 12.50),
}
# Fast mode is the same model at premium rates (Opus 5: $10/$50).
_FAST_MULTIPLIER = 2.0


def _rates(model: str) -> tuple[float, float, float, float]:
    match = max((k for k in _RATES if model.startswith(k)), key=len, default="")
    return _RATES.get(match, _RATES["claude-opus-5"])


def _log_usage(
    model: str, effort: str, route: str, fast: bool, response: Any, elapsed: float
) -> None:
    """Log tokens, what they cost, and how long the call took.

    Four token counters, not three: `cache_creation_input_tokens` bills at
    1.25x input and on a cold cache is the largest single item in the request,
    so a line without it cannot be reconciled against the Console.

    `elapsed` is the API call alone — not the endpoint. Read it against the
    stage timings the routes log: if the two nearly match, the wait is Claude
    and only a cheaper model or lower effort moves it; if they diverge, the
    time is on this side and the log says which stage has it.
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return

    def _n(field: str) -> int:
        value = getattr(usage, field, 0)
        return int(value) if isinstance(value, (int, float)) else 0

    fresh = _n("input_tokens")
    cache_read = _n("cache_read_input_tokens")
    cache_write = _n("cache_creation_input_tokens")
    out = _n("output_tokens")

    in_rate, out_rate, read_rate, write_rate = _rates(model)
    served_fast = (getattr(usage, "speed", None) or "standard") == "fast"
    scale = _FAST_MULTIPLIER if served_fast else 1.0
    # Kept per component, not just as a total: when a bill looks wrong the
    # answer is almost always which bucket the tokens landed in — a cold cache
    # billing the prefix at 1.25x, or output far longer than the schema needs.
    cost_in = scale * fresh * in_rate / 1_000_000
    cost_cache_read = scale * cache_read * read_rate / 1_000_000
    cost_cache_write = scale * cache_write * write_rate / 1_000_000
    cost_out = scale * out * out_rate / 1_000_000
    usd = cost_in + cost_cache_read + cost_cache_write + cost_out

    # `priced` says whether _rates matched this model or fell back to the Opus
    # row. An unrecognised id still logs a number, and a number that is quietly
    # the wrong model's rate is worse than no number at all.
    priced = any(model.startswith(known) for known in _RATES)
    cost_log.record(
        route=route,
        provider="claude",
        model=model,
        effort=effort,
        speed="fast" if served_fast else "standard",
        input_tokens=fresh,
        cache_read_tokens=cache_read,
        cache_write_tokens=cache_write,
        output_tokens=out,
        cost_input_usd=round(cost_in, 6),
        cost_cache_read_usd=round(cost_cache_read, 6),
        cost_cache_write_usd=round(cost_cache_write, 6),
        cost_output_usd=round(cost_out, 6),
        cost_usd=round(usd, 6),
        elapsed_seconds=round(elapsed, 2),
        priced=priced,
    )

    log.info(
        "Claude %s route=%s effort=%s speed=%s: in=%d cache_read=%d "
        "cache_write=%d out=%d cost=$%.5f in %.1fs",
        model,
        route,
        effort,
        "fast" if served_fast else "standard",
        fresh,
        cache_read,
        cache_write,
        out,
        usd,
        elapsed,
    )



class ClaudeError(RuntimeError):
    """Raised when the Claude API is unreachable or returns unusable output."""


def _get_client() -> Any:
    """One client for the process — it holds a connection pool worth reusing."""
    global _client
    if _client is not None:
        return _client

    try:
        from anthropic import AsyncAnthropic
    except ImportError as err:
        raise ClaudeError(
            "anthropic is not installed. Run: pip install anthropic"
        ) from err

    if not settings.claude_api_key:
        raise ClaudeError("ANTHROPIC_API_KEY is not set.")

    # An identity-linked key is rejected with a 400 unless the request names the
    # workspace it acts in. Sent as a default header so it rides on every call.
    headers = (
        {"anthropic-workspace-id": settings.claude_workspace_id}
        if settings.claude_workspace_id
        else None
    )
    _client = AsyncAnthropic(
        api_key=settings.claude_api_key,
        timeout=float(settings.claude_timeout_seconds),
        default_headers=headers,
    )
    return _client


def _strict(node: Any) -> Any:
    """Return `node` with every object closed and all of its keys required.

    Structured outputs will not accept an open object: each one needs
    `additionalProperties: false` and a `required` naming every property. The
    schemas in schemas.py are shared with Ollama, which wants neither, so the
    tightening happens here rather than in the shared constant.

    Requiring every key is safe for these schemas because "the doctor did not
    say this" is already encoded as an empty string or null, never as an absent
    key — the model still has a way to say nothing.
    """
    if isinstance(node, dict):
        out = {key: _strict(value) for key, value in node.items()}
        if out.get("type") == "object" and isinstance(out.get("properties"), dict):
            out["additionalProperties"] = False
            out["required"] = list(out["properties"].keys())
        return out
    if isinstance(node, list):
        return [_strict(item) for item in node]
    return node


# Fast mode is a research preview on the beta endpoint, gated by this flag.
_FAST_MODE_BETA = "fast-mode-2026-02-01"


def _is_opus(model: str) -> bool:
    return "opus" in model.lower()


async def _create(client: Any, *, fast: bool, **params: Any) -> Any:
    """One Messages call, on the fast path when asked for and available.

    Fast mode runs the same Opus model at up to ~2.5x the output speed, at a
    premium price, and it has its own rate limit. When that limit answers 429
    the call is made again without `speed` — same request, standard speed —
    rather than walking down to Gemini for what is only a capacity blip.
    The SDK's own retries still apply on top of this for transient failures.
    """
    if fast and _is_opus(params["model"]):
        from anthropic import RateLimitError

        try:
            return await client.beta.messages.create(
                speed="fast", betas=[_FAST_MODE_BETA], **params
            )
        except RateLimitError:
            log.warning("Fast mode rate-limited; retrying at standard speed.")
    return await client.messages.create(**params)


# `output_config.effort` is not accepted by every model: Haiku 4.5 and the
# 4.5-era Sonnets answer with 400 "This model does not support the effort
# parameter." Sending it regardless turns a model swap into a silent outage —
# every call raises, the chain falls through to Gemini or the local model, and
# imaging reports come back "could not be read" — so the knob is dropped for
# models that cannot take it instead of failing the request.
_NO_EFFORT_PREFIXES = ("claude-haiku-", "claude-sonnet-4-5", "claude-sonnet-3")


def _supports_effort(model: str) -> bool:
    return not model.startswith(_NO_EFFORT_PREFIXES)


def _output_config(model: str, effort: str, schema: dict[str, Any]) -> dict[str, Any]:
    config: dict[str, Any] = {
        "format": {"type": "json_schema", "schema": _strict(schema)}
    }
    if _supports_effort(model):
        config["effort"] = effort
    return config


async def generate_json(
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    route: str = "llm",
    effort: str | None = None,
    max_tokens: int | None = None,
    model: str | None = None,
    fast: bool = False,
) -> dict[str, Any]:
    """Run a completion whose output is constrained to `schema`.

    `effort` controls how much the model thinks before answering. Extraction
    runs at its own configured level (medium — enough to segment a run-on
    sentence, short enough that the doctor is not left waiting); the summary
    endpoints pass "high" because a doctor reads that output closely and the
    call volume is a fraction of extraction's.

    `model` and `fast` exist for the extraction route alone: a different
    model can be tried there without touching the summaries, and fast mode
    trades price for output speed on the one call a patient is waiting on.
    """
    client = _get_client()
    model = model or settings.claude_model

    started = time.monotonic()
    try:
        response = await _create(
            client,
            fast=fast,
            model=model,
            max_tokens=max_tokens or settings.claude_max_tokens,
            system=[
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user}],
            output_config=_output_config(
                model, effort or settings.claude_effort, schema
            ),
        )
    except Exception as err:
        raise ClaudeError(f"Claude API call failed: {err}") from err

    # A safety classifier can decline with HTTP 200, so stop_reason is checked
    # before the content is read. Both of these walk down to Gemini/Ollama.
    if response.stop_reason == "refusal":
        raise ClaudeError("Claude declined this request.")
    if response.stop_reason == "max_tokens":
        raise ClaudeError(
            f"Claude hit max_tokens ({max_tokens or settings.claude_max_tokens}); "
            "the JSON is truncated."
        )

    text = next((b.text for b in response.content if b.type == "text"), "").strip()
    if not text:
        raise ClaudeError("Claude returned an empty response.")

    # At info, not debug: this line is how a slow draft gets diagnosed in
    # production. cache_read staying at 0 across requests means the prefix is
    # being invalidated somewhere; `speed` says whether fast mode served it.
    _log_usage(
        model,
        (effort or settings.claude_effort) if _supports_effort(model) else "n/a",
        route,
        fast,
        response,
        time.monotonic() - started,
    )

    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        log.error("Claude output failed to parse as JSON: %s", text[:500])
        raise ClaudeError(f"Claude produced invalid JSON: {err}") from err


async def generate_json_from_image(
    system: str,
    user: str,
    image: bytes,
    media_type: str,
    schema: dict[str, Any],
    *,
    route: str = "llm-image",
    effort: str | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """`generate_json`, with an image in the user turn.

    For reports that are pictures rather than text — an X-ray film, an ECG
    strip, a scan — where OCR has nothing to give the text path. The image
    goes first and the instruction after it, which is the order the model
    reads best. Same structured output and the same refusal/truncation
    handling as the text call; a failure here is a ClaudeError for the caller
    to fall back on, never a summary.
    """
    import base64

    client = _get_client()
    data = base64.standard_b64encode(image).decode("ascii")

    started = time.monotonic()
    try:
        response = await client.messages.create(
            model=settings.claude_model,
            max_tokens=max_tokens or settings.claude_max_tokens,
            system=[
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data,
                            },
                        },
                        {"type": "text", "text": user},
                    ],
                }
            ],
            output_config=_output_config(
                settings.claude_model, effort or settings.claude_effort, schema
            ),
        )
    except Exception as err:
        raise ClaudeError(f"Claude API call failed: {err}") from err

    if response.stop_reason == "refusal":
        raise ClaudeError("Claude declined this request.")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Claude hit max_tokens; the JSON is truncated.")

    text = next((b.text for b in response.content if b.type == "text"), "").strip()
    if not text:
        raise ClaudeError("Claude returned an empty response.")

    # This path logged nothing before, so a photographed report — the most
    # expensive call in the system, an image at effort=high — was invisible in
    # both the log and any cost total built from it.
    _log_usage(
        settings.claude_model,
        (effort or settings.claude_effort)
        if _supports_effort(settings.claude_model)
        else "n/a",
        route,
        False,
        response,
        time.monotonic() - started,
    )

    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        log.error("Claude output failed to parse as JSON: %s", text[:500])
        raise ClaudeError(f"Claude produced invalid JSON: {err}") from err
