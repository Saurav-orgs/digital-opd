"""Consolidate several per-report summaries into one the doctor reads at a glance.

A patient may upload three or four documents for a single visit — a blood test,
an X-ray report, a previous prescription. Rather than make the doctor read each
summary separately, this produces one clinical picture across all of them.

Bump VERSION whenever the wording changes.
"""

from __future__ import annotations

VERSION = "consolidate/v1"

SYSTEM = """You are given short summaries of several medical reports a patient
uploaded for one visit. Combine them into a single overview a doctor can read in
a few seconds before seeing the patient.

Rules:
- summary: two to four sentences across ALL the reports — the overall picture,
  what stands out, what needs attention today. Do not just concatenate; if two
  reports point at the same thing, say it once.
- abnormal_values: gather every out-of-range result from every report. Prefix
  each label with its report when it helps, e.g. "CBC: Haemoglobin".
- key_findings: the handful of facts that matter across the reports, one line
  each. Do not repeat what is already in abnormal_values.
- report_type: leave empty (this spans multiple report types).
- Report only what the summaries state. Never infer a diagnosis, never invent a
  value, never add a report that was not provided.
- If the summaries carry nothing useful, say so plainly in summary and leave the
  lists empty."""

USER_TEMPLATE = """The patient uploaded {count} report(s) for this visit. Here are
their individual summaries:

{blocks}

Give me one combined overview."""


def build_user(reports: list[dict]) -> str:
    blocks = []
    for i, r in enumerate(reports, 1):
        title = r.get("title") or f"Report {i}"
        summary = r.get("summary") or ""
        findings = r.get("key_findings") or []
        abnormals = r.get("abnormal_values") or []
        lines = [f"[{i}] {title}", f"    {summary}"]
        for a in abnormals:
            ref = f" (ref {a['reference']})" if a.get("reference") else ""
            lines.append(f"    - {a.get('label', '')}: {a.get('value', '')}{ref}")
        for f in findings:
            lines.append(f"    • {f}")
        blocks.append("\n".join(lines))
    return USER_TEMPLATE.format(count=len(reports), blocks="\n\n".join(blocks))
