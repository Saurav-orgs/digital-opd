#!/usr/bin/env python
"""Total what the Claude calls have cost, from the JSONL cost log.

    python scripts/cost_report.py                      # everything, by route
    python scripts/cost_report.py --by model           # compare Haiku vs Opus
    python scripts/cost_report.py --by day
    python scripts/cost_report.py --route report-summary --route report-summary-image
    python scripts/cost_report.py --since 2026-09-24
    python scripts/cost_report.py --prescriptions       # cost of ONE prescription

The per-call average is the number worth reading: totals only say how much the
service was used, while the average says what one report costs on the model
currently configured — which is the question a model swap is meant to answer.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, "data", "cost-log.jsonl")


def load(path: str) -> list[dict]:
    if not os.path.exists(path):
        sys.exit(f"No cost log at {path}. Upload a report first, or pass --path.")
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"  (skipped malformed line {line_no})", file=sys.stderr)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--path", default=DEFAULT)
    ap.add_argument("--by", default="route",
                    choices=["route", "model", "day", "effort", "speed", "provider"])
    ap.add_argument("--route", action="append",
                    help="only these routes (repeatable)")
    ap.add_argument("--since", help="ISO date, e.g. 2026-09-24")
    ap.add_argument("--inr", type=float, default=89.0,
                    help="USD->INR rate for the rupee column (default 89)")
    ap.add_argument("--prescriptions", action="store_true",
                    help="one row per consultation: speech + LLM, and the total")
    args = ap.parse_args()

    rows = load(args.path)
    if args.route:
        rows = [r for r in rows if r.get("route") in set(args.route)]
    if args.since:
        rows = [r for r in rows if str(r.get("ts", "")) >= args.since]
    if not rows:
        sys.exit("No matching calls.")

    if args.prescriptions:
        prescriptions(rows, args)
        return

    unpriced = [r for r in rows if r.get("priced") is False]

    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        key = str(r.get("ts", ""))[:10] if args.by == "day" else str(r.get(args.by, "?"))
        groups[key].append(r)

    def s(rs: list[dict], field: str) -> float:
        return sum(float(r.get(field, 0) or 0) for r in rs)

    # Free-tier Gemini bills nothing, so `billed` and `would` diverge. Showing
    # only one of them either hides real spend or invents spend that never
    # happened; the pair is what makes a mixed Claude/Gemini log readable.
    head = (f"{args.by:26} {'calls':>6} {'in':>9} {'out':>8} "
            f"{'billed $':>10} {'would $':>10} {'Rs/call*':>9} {'s/call':>7}")
    print(head)
    print("-" * len(head))

    def would(rs: list[dict]) -> float:
        # Claude rows have no would_cost_usd — for them what was billed is
        # what it would cost, so the column stays comparable across providers.
        return sum(float(r.get("would_cost_usd", r.get("cost_usd", 0)) or 0) for r in rs)

    for key in sorted(groups):
        rs = groups[key]
        n = len(rs)
        total, w = s(rs, "cost_usd"), would(rs)
        print(f"{key:26} {n:>6} {s(rs,'input_tokens'):>9,.0f} "
              f"{s(rs,'output_tokens'):>8,.0f} "
              f"{total:>10.5f} {w:>10.5f} {w/n*args.inr:>9.3f} "
              f"{s(rs,'elapsed_seconds')/n:>7.1f}")

    n = len(rows)
    total, w = s(rows, "cost_usd"), would(rows)
    print("-" * len(head))
    print(f"{'ALL':26} {n:>6} {s(rows,'input_tokens'):>9,.0f} "
          f"{s(rows,'output_tokens'):>8,.0f} "
          f"{total:>10.5f} {w:>10.5f} {w/n*args.inr:>9.3f} "
          f"{s(rows,'elapsed_seconds')/n:>7.1f}")

    free = [r for r in rows if r.get("free_tier")]
    if free:
        fw = would(free)
        print(f"\n* Rs/call is the WOULD-cost (what a paid key charges), not what you paid.")
        print(f"  {len(free)} of {n} call(s) ran on the Gemini free tier: "
              f"${fw:.5f} (Rs {fw*args.inr:.2f}) not billed.")

    cold = s(rows, "cost_cache_write_usd")
    warm = s(rows, "cost_cache_read_usd")
    if cold or warm:
        print(f"\ncache: ${cold:.5f} spent writing vs ${warm:.5f} reading "
              f"({s(rows,'cache_read_tokens')/max(s(rows,'cache_read_tokens')+s(rows,'cache_write_tokens'),1):.0%} of "
              f"prefix tokens served from cache)")
    if unpriced:
        models = sorted({r.get("model", "?") for r in unpriced})
        print(f"\nWARNING: {len(unpriced)} call(s) on unpriced model(s) {models} — "
              f"costed at the Opus 5 fallback rate, so those rows are wrong.")


def prescriptions(rows: list[dict], args) -> None:
    """What one voice prescription costs, end to end.

    A prescription is not one call — it is however many seconds of speech the
    doctor dictated, cut into chunks, plus a single extraction over the
    transcript that results. Those rows only add up because each carries the
    `session_id` the backend sent; rows without one predate that and are
    reported separately rather than silently dropped or silently merged.

    The two halves are priced in completely different units — Sarvam by audio
    duration, the LLM by tokens — so the split is the interesting part. It is
    what says whether talking for longer or thinking for longer is what costs
    money here.
    """
    grouped: dict[str, list[dict]] = defaultdict(list)
    orphans = []
    for r in rows:
        sid = r.get("session_id")
        (grouped[sid] if sid else orphans).append(r)

    if not grouped:
        sys.exit(
            "No rows carry a session_id yet. Record one consultation through "
            "the app (the backend sends it), then run this again."
        )

    def money(rs: list[dict]) -> float:
        # would_cost_usd, not cost_usd: on the Gemini free tier the latter is
        # zero, and "free today" is not the answer to "what does this cost".
        return sum(float(r.get("would_cost_usd", r.get("cost_usd", 0)) or 0) for r in rs)

    head = (f"{'consultation':38} {'audio':>7} {'stt Rs':>8} {'tok in':>8} {'tok out':>8} "
            f"{'llm Rs':>8} {'TOTAL Rs':>9}")
    print(head)
    print("-" * len(head))

    totals = []
    for sid in sorted(grouped, key=lambda k: min(str(r.get("ts", "")) for r in grouped[k])):
        rs = grouped[sid]
        stt = [r for r in rs if r.get("provider") == "sarvam"]
        llm = [r for r in rs if r.get("provider") != "sarvam"]
        audio = sum(float(r.get("audio_seconds", 0) or 0) for r in stt)
        stt_inr = money(stt) * args.inr
        llm_inr = money(llm) * args.inr
        tok_in = sum(float(r.get("input_tokens", 0) or 0) for r in llm)
        tok_out = sum(
            float(r.get("output_tokens", 0) or 0) + float(r.get("thinking_tokens", 0) or 0)
            for r in llm
        )
        totals.append((audio, stt_inr, llm_inr))
        print(f"{sid[:38]:38} {audio:>6.1f}s {stt_inr:>8.4f} {tok_in:>8,.0f} "
              f"{tok_out:>8,.0f} {llm_inr:>8.4f} {stt_inr + llm_inr:>9.4f}")

    n = len(totals)
    audio = sum(t[0] for t in totals)
    stt_inr = sum(t[1] for t in totals)
    llm_inr = sum(t[2] for t in totals)
    total = stt_inr + llm_inr
    print("-" * len(head))
    print(f"{f'MEAN of {n}':38} {audio/n:>6.1f}s {stt_inr/n:>8.4f} "
          f"{'':>8} {'':>8} {llm_inr/n:>8.4f} {total/n:>9.4f}")
    print(
        f"\nPer prescription: Rs {total/n:.4f} "
        f"(speech {stt_inr/total:.0%}, model {llm_inr/total:.0%}) "
        f"— about Rs {total/n*100:.2f} per 100 prescriptions."
    )

    free = [r for r in rows if r.get("free_tier")]
    if free:
        print(
            f"NOTE: {len(free)} model call(s) ran on the Gemini FREE tier. The "
            f"rupees above are what a paid key would charge, which is the "
            f"number to plan with."
        )
    if orphans:
        print(
            f"\n{len(orphans)} row(s) carry no session_id (recorded before the "
            f"backend sent one, or from a route that does not) and are not "
            f"counted above."
        )


if __name__ == "__main__":
    main()
