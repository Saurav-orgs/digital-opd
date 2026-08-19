"""Ollama client with schema-constrained JSON output.

Ollama's `format` parameter accepts a JSON schema and constrains decoding to it,
so the model cannot produce output that fails to parse. That removes the whole
class of "the LLM returned prose instead of JSON" failures without a retry loop.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger(__name__)


class LlmError(RuntimeError):
    """Raised when the local LLM is unreachable or returns unusable output."""


async def is_reachable() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{settings.ollama_url}/api/tags")
            return res.status_code == 200
    except Exception:
        return False


async def generate_json(
    system: str,
    user: str,
    schema: dict[str, Any],
) -> dict[str, Any]:
    """Run a chat completion whose output is constrained to `schema`."""
    payload = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "format": schema,
        "stream": False,
        "options": {
            # Deterministic: this is extraction, not creative writing. The same
            # transcript should produce the same prescription every time.
            "temperature": 0,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            res = await client.post(f"{settings.ollama_url}/api/chat", json=payload)
    except httpx.HTTPError as err:
        raise LlmError(f"Could not reach the local LLM at {settings.ollama_url}: {err}") from err

    if res.status_code != 200:
        raise LlmError(f"LLM returned HTTP {res.status_code}: {res.text[:300]}")

    content = res.json().get("message", {}).get("content", "")
    if not content.strip():
        raise LlmError("LLM returned an empty response.")

    try:
        return json.loads(content)
    except json.JSONDecodeError as err:
        # Should be unreachable given `format`, but a corrupted stream is still
        # possible — fail loudly rather than handing the backend half an object.
        log.error("Schema-constrained output failed to parse: %s", content[:500])
        raise LlmError(f"LLM produced invalid JSON: {err}") from err
