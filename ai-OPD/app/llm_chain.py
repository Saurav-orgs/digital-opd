"""The one place that decides which backend serves an LLM call.

Every route wants the same thing — try Claude, then Gemini, then the local
model, and log which one answered — and before this module each of the four
wrote that chain out by hand. Four copies of a fallback policy is four places
for it to drift, and it had already: the imaging route never learned about
Gemini at all, so a clinic running without an Anthropic key was told its
X-rays "could not be read" when Gemini could read them perfectly well.

What is deliberately NOT here:

  * What to do when nothing answers. `NoBackend` is raised and the caller
    decides, because the right answer differs per route — a report summary
    is a 503, a consolidation falls back to joining the source summaries
    verbatim, and both are correct.
  * Whether the local model may write clinical narrative. That is the
    caller's `local=` argument, because it is a judgement about the output,
    not about which providers happen to be up. See ALLOW_LOCAL_NARRATIVE.
"""

from __future__ import annotations

import logging
from typing import Any

from . import claude_llm, gemini_llm, llm
from .config import settings

log = logging.getLogger(__name__)


class NoBackend(RuntimeError):
    """Every backend was unavailable, refused, or failed."""


def claude_ready() -> bool:
    return bool(settings.claude_enabled and settings.claude_api_key)


def gemini_ready() -> bool:
    return bool(settings.gemini_enabled and settings.gemini_api_key)


async def generate_json(
    *,
    system: str,
    user: str,
    schema: dict[str, Any],
    route: str,
    effort: str = "high",
    claude_prompt: tuple[str, str] | None = None,
    claude_kw: dict[str, Any] | None = None,
    local: bool = True,
) -> tuple[dict[str, Any], str]:
    """Run `route` on the best available backend. Returns (json, provider).

    The provider name is returned, not just logged, because callers act on
    it: the prescription route's regex grounding guards were written to catch
    a 3B model, and applied to a frontier model's output they subtract more
    than they add.

    `effort` is Claude's alone — the summary routes pass "high" because a
    doctor reads that output closely and they run a fraction as often as
    extraction.

    `claude_prompt` overrides (system, user) for the Claude attempt only.
    Extraction uses it: the local and Gemini paths keep the prompt they were
    tuned against, while Claude gets a much shorter one, because the guards
    downstream do the mechanical work its rules would otherwise describe.

    `local` is whether the local model may serve this route at all. False
    means the chain stops after Gemini and raises rather than letting a 3B
    model write clinical narrative.
    """
    if claude_ready():
        c_system, c_user = claude_prompt or (system, user)
        kw: dict[str, Any] = {"route": route, "effort": effort}
        kw.update(claude_kw or {})
        try:
            return await claude_llm.generate_json(c_system, c_user, schema, **kw), "claude"
        except Exception as err:
            log.warning("Claude %s failed (%s); falling back to Gemini.", route, err)

    if gemini_ready():
        try:
            return await gemini_llm.generate_json(
                system, user, schema, route=route
            ), "gemini"
        except Exception as err:
            log.warning("Gemini %s failed (%s); falling back to the local model.", route, err)

    if not local:
        raise NoBackend(
            f"No cloud backend could serve {route}, and the local model is not "
            "trusted with this output."
        )
    if not settings.local_llm_enabled:
        raise NoBackend(
            f"No cloud backend could serve {route}, and the local model is "
            "disabled (LOCAL_LLM_ENABLED=false)."
        )

    try:
        return await llm.generate_json(system, user, schema), "ollama"
    except Exception as err:
        raise NoBackend(f"Every backend failed for {route}: {err}") from err


async def generate_json_from_image(
    *,
    system: str,
    user: str,
    image: bytes,
    media_type: str,
    schema: dict[str, Any],
    route: str,
    effort: str = "high",
) -> tuple[dict[str, Any], str]:
    """The same chain for a report that is a picture — an X-ray, an ECG strip.

    Two tiers, not three: the local model has no eyes, so there is nothing
    under Gemini to fall through to. Both hosted backends read an image, and
    either one is enough to keep a clinic's imaging working — which is the
    whole point of this function existing, since the route used to be Claude
    or nothing.
    """
    if claude_ready():
        try:
            return await claude_llm.generate_json_from_image(
                system, user, image, media_type, schema, route=route, effort=effort
            ), "claude"
        except Exception as err:
            log.warning("Claude %s failed (%s); falling back to Gemini.", route, err)

    if gemini_ready():
        try:
            return await gemini_llm.generate_json_from_image(
                system, user, image, media_type, schema, route=route
            ), "gemini"
        except Exception as err:
            log.warning("Gemini %s failed (%s).", route, err)

    raise NoBackend(f"No backend able to read an image is configured for {route}.")
