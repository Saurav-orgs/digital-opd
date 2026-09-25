"""Append-only record of what each billable model call cost.

The INFO log already prints the same numbers, but a log line cannot be summed:
it rotates, it interleaves with request noise, and answering "what does a
report cost on Haiku vs Opus" from it means grepping and adding by hand. One
JSON object per call, one line each, is enough to total by route, by model and
by day — `scripts/cost_report.py` does exactly that.

Never raises. A failure to record spend must not fail the request that earned
it, so every error here is swallowed after a warning.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

from .config import settings

log = logging.getLogger(__name__)

# Uvicorn serves requests from a thread pool and the endpoints run
# concurrently, so two report uploads can finish inside each other. A lock
# around the append keeps lines whole; they are short enough that the cost of
# holding it is irrelevant next to the API call that produced them.
_lock = threading.Lock()
_warned = False

# The consultation a call belongs to, so the several rows one prescription
# produces — N transcription chunks and one extraction — can be added up as
# the one thing the doctor actually did.
#
# A ContextVar rather than an argument because the alternative is threading an
# id through gemini_llm, claude_llm and llm purely so the last line of each can
# write it down. Each request runs in its own asyncio context, so concurrent
# consultations cannot see each other's value, and a call made outside a
# request simply has none.
_session: contextvars.ContextVar[str] = contextvars.ContextVar("cost_session", default="")

# What this one request has spent so far, so the endpoint can hand it back to
# the backend, which is the only side that knows what an appointment is and
# has a database to keep it in.
#
# It collects at `record()` rather than at the call sites deliberately: every
# billable call already passes through there, so a retry, or a fallback from
# Claude to Gemini, is counted without anyone remembering to count it. A tally
# assembled by hand at the endpoint would miss exactly those, and they are the
# expensive ones.
_events: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar(
    "cost_events", default=None
)


def bind_session(session_id: str) -> None:
    """Attribute everything recorded from here on to this consultation."""
    _session.set(session_id or "")


def start_request() -> None:
    """Begin collecting this request's spend. Called at the top of a route."""
    _events.set([])


def drain() -> list[dict]:
    """Everything recorded since `start_request`, and stop collecting.

    Returned to the caller in the response body. Empty is a normal answer: a
    cached result, a route that did no paid work, or a failure before the
    model was reached all legitimately cost nothing.

    Every row leaves here carrying BOTH currencies, because the providers do
    not agree on one: Sarvam prices speech in rupees per hour, the LLMs price
    tokens in dollars per million. Filling the gap here means the backend can
    sum a column without asking which provider a row came from — and getting
    that conditional wrong would undercount one whole side of the bill.

    `would_cost_usd` is the planning figure: what a paid key charges. For
    Sarvam, which is always paid, it is simply the cost. For Gemini on the
    free tier `cost_usd` is 0 while this is not, and this is the one to use.
    """
    events = _events.get() or []
    _events.set(None)
    for e in events:
        if not e.get("would_cost_usd"):
            e["would_cost_usd"] = e.get("cost_usd", 0.0) or 0.0
        if not e.get("cost_inr"):
            e["cost_inr"] = round(e["would_cost_usd"] * settings.usd_inr_rate, 6)
    return events


def _resolve(path: str) -> str:
    """Absolute path for the log, resolved against the service directory.

    Relative to the package's parent, not the process's cwd: the service is
    started from different places (shell, systemd, Docker) and the log should
    not follow the working directory around.
    """
    if os.path.isabs(path):
        return path
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, path)


def record(**fields: Any) -> None:
    """Record one call's usage and cost.

    Goes to two places that fail independently: the in-memory list this
    request will return to the backend, and the JSONL file. AI_COST_LOG_PATH
    disables only the file — the response still carries the numbers, because
    that is now how they reach the database.
    """
    global _warned

    entry = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    session = _session.get()
    if session and "session_id" not in fields:
        entry["session_id"] = session
    entry.update(fields)

    # Collected before the write, so a request still reports what it spent even
    # if the file is unwritable. The two destinations are independent on
    # purpose: a full disk must not also lose the billing record.
    events = _events.get()
    if events is not None:
        events.append(entry)

    if not settings.cost_log_path:
        return

    target = _resolve(settings.cost_log_path)
    try:
        with _lock:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as err:
        # Once, not per call: a read-only volume would otherwise fill the log
        # with the same warning at the rate of the traffic it cannot record.
        if not _warned:
            _warned = True
            log.warning("Cost log disabled — could not write %s: %s", target, err)
