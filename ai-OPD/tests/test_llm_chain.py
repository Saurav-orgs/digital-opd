"""Which backend serves a call, and what happens when one is out.

This is the policy every route now shares, so it is asserted here rather than
inferred from four call sites. The tier that matters most is the last one: a
route marked `local=False` must fail loudly rather than let a 3B model write
clinical narrative, and the imaging chain must reach Gemini — it used to be
Claude or nothing, which told clinics without an Anthropic key that their
X-rays could not be read.

Driven with `asyncio.run` rather than pytest-asyncio: this project does not
depend on it, and one `run()` per test is cheaper than a new test dependency.
"""

import asyncio

import pytest

from app import llm_chain
from app.config import settings


@pytest.fixture
def backends(monkeypatch):
    """Turn each tier on or off and record which ones were asked."""
    called: list[str] = []

    class Fake:
        claude: object = "ok"
        gemini: object = "ok"
        local: object = "ok"

        def _answer(self, name: str) -> dict:
            called.append(name)
            outcome = getattr(self, name)
            if isinstance(outcome, Exception):
                raise outcome
            return {"served_by": name}

    fake = Fake()
    fake.called = called

    async def claude_json(*a, **k):
        return fake._answer("claude")

    async def claude_image(*a, **k):
        return fake._answer("claude")

    async def gemini_json(*a, **k):
        return fake._answer("gemini")

    async def gemini_image(*a, **k):
        return fake._answer("gemini")

    async def local_json(*a, **k):
        return fake._answer("local")

    monkeypatch.setattr(llm_chain.claude_llm, "generate_json", claude_json)
    monkeypatch.setattr(llm_chain.claude_llm, "generate_json_from_image", claude_image)
    monkeypatch.setattr(llm_chain.gemini_llm, "generate_json", gemini_json)
    monkeypatch.setattr(llm_chain.gemini_llm, "generate_json_from_image", gemini_image)
    monkeypatch.setattr(llm_chain.llm, "generate_json", local_json)

    # Every tier configured unless a test says otherwise.
    monkeypatch.setattr(settings, "claude_enabled", True)
    monkeypatch.setattr(settings, "claude_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_enabled", True)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "local_llm_enabled", True)

    return fake


def chain(**kw):
    return asyncio.run(
        llm_chain.generate_json(system="s", user="u", schema={}, route="test", **kw)
    )


def image_chain():
    return asyncio.run(
        llm_chain.generate_json_from_image(
            system="s",
            user="u",
            image=b"\x89PNG",
            media_type="image/png",
            schema={},
            route="report-summary-image",
        )
    )


# ── Text chain ───────────────────────────────────────────────


def test_claude_serves_when_it_can(backends):
    raw, provider = chain()
    assert provider == "claude"
    assert raw == {"served_by": "claude"}
    assert backends.called == ["claude"]


def test_falls_to_gemini_when_claude_fails(backends):
    backends.claude = RuntimeError("503 from Anthropic")
    _, provider = chain()
    assert provider == "gemini"
    assert backends.called == ["claude", "gemini"]


def test_skips_claude_entirely_when_it_is_off(backends, monkeypatch):
    """The production shape today: AI_CLAUDE_ENABLED=false, Gemini first."""
    monkeypatch.setattr(settings, "claude_enabled", False)
    _, provider = chain()
    assert provider == "gemini"
    assert backends.called == ["gemini"]


def test_falls_to_local_when_both_hosted_fail(backends):
    backends.claude = RuntimeError("down")
    backends.gemini = RuntimeError("down")
    _, provider = chain()
    assert provider == "ollama"
    assert backends.called == ["claude", "gemini", "local"]


def test_never_reaches_local_for_narrative(backends):
    """ALLOW_LOCAL_NARRATIVE=false must fail rather than degrade quietly."""
    backends.claude = RuntimeError("down")
    backends.gemini = RuntimeError("down")
    with pytest.raises(llm_chain.NoBackend):
        chain(local=False)
    assert "local" not in backends.called


def test_respects_local_llm_disabled(backends, monkeypatch):
    monkeypatch.setattr(settings, "local_llm_enabled", False)
    backends.claude = RuntimeError("down")
    backends.gemini = RuntimeError("down")
    with pytest.raises(llm_chain.NoBackend):
        chain()
    assert "local" not in backends.called


def test_raises_when_every_tier_fails(backends):
    backends.claude = RuntimeError("down")
    backends.gemini = RuntimeError("down")
    backends.local = RuntimeError("connection refused")
    with pytest.raises(llm_chain.NoBackend):
        chain()


def test_claude_gets_its_own_prompt(backends, monkeypatch):
    """Extraction hands Claude a shorter prompt than the other two get."""
    seen: dict = {}

    async def claude_json(system, user, schema, **kw):
        seen["prompt"] = (system, user)
        seen["kw"] = kw
        return {}

    monkeypatch.setattr(llm_chain.claude_llm, "generate_json", claude_json)
    asyncio.run(
        llm_chain.generate_json(
            system="long",
            user="long-user",
            schema={},
            route="prescription",
            claude_prompt=("short", "short-user"),
            claude_kw={"effort": "medium", "fast": True},
        )
    )
    assert seen["prompt"] == ("short", "short-user")
    # The route's own settings win over the chain's defaults.
    assert seen["kw"]["effort"] == "medium"
    assert seen["kw"]["fast"] is True
    assert seen["kw"]["route"] == "prescription"


# ── Imaging chain ────────────────────────────────────────────


def test_gemini_reads_the_image_when_claude_is_off(backends, monkeypatch):
    """The bug this chain was written for: a Gemini-only clinic's X-rays."""
    monkeypatch.setattr(settings, "claude_enabled", False)
    raw, provider = image_chain()
    assert provider == "gemini"
    assert raw == {"served_by": "gemini"}


def test_image_falls_from_claude_to_gemini(backends):
    backends.claude = RuntimeError("refused")
    _, provider = image_chain()
    assert provider == "gemini"
    assert backends.called == ["claude", "gemini"]


def test_image_never_reaches_the_local_model(backends):
    """It has no eyes — there is nothing under Gemini to fall through to."""
    backends.claude = RuntimeError("down")
    backends.gemini = RuntimeError("down")
    with pytest.raises(llm_chain.NoBackend):
        image_chain()
    assert "local" not in backends.called


def test_image_raises_with_no_hosted_backend(backends, monkeypatch):
    monkeypatch.setattr(settings, "claude_enabled", False)
    monkeypatch.setattr(settings, "gemini_enabled", False)
    with pytest.raises(llm_chain.NoBackend):
        image_chain()
    assert backends.called == []
