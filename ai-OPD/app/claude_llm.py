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
from typing import Any

from .config import settings

log = logging.getLogger(__name__)

_client: Any = None


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


async def generate_json(
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    effort: str | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Run a completion whose output is constrained to `schema`.

    `effort` controls how much the model thinks before answering. Extraction
    runs at the configured default (medium — enough to segment a run-on
    sentence, short enough that the doctor is not left waiting); the summary
    endpoints pass "high" because a doctor reads that output closely and the
    call volume is a fraction of extraction's.
    """
    client = _get_client()

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
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": effort or settings.claude_effort,
                "format": {"type": "json_schema", "schema": _strict(schema)},
            },
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

    usage = getattr(response, "usage", None)
    if usage is not None:
        # cache_read_input_tokens staying at 0 across requests means the prefix
        # is being invalidated somewhere — worth seeing in the logs.
        log.debug(
            "Claude %s: in=%s cache_read=%s out=%s",
            settings.claude_model,
            getattr(usage, "input_tokens", "?"),
            getattr(usage, "cache_read_input_tokens", "?"),
            getattr(usage, "output_tokens", "?"),
        )

    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        log.error("Claude output failed to parse as JSON: %s", text[:500])
        raise ClaudeError(f"Claude produced invalid JSON: {err}") from err
