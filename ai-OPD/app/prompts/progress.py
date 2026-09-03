"""Compare a patient's previous visit against this one.

The doctor's question at a follow-up is never "what do these reports say" — it
is "is this person better or worse than last time, and what needs attention
today". This prompt answers that from the summaries already computed for each
visit, so nothing is re-read from the source documents.

Only two visits ever reach the model: the most recent earlier one and the
current one. Nothing older is lost, because the previous visit's own progress
summary is what gets passed as its picture — the trajectory travels forward in
condensed form rather than by re-reading a growing history.

The danger here is different from single-report summarisation. There, a wrong
sentence misreads a document. Here, a wrong sentence tells a doctor a patient is
improving when they are deteriorating. Every rule below exists to make the model
say less rather than guess.

Bump VERSION whenever the wording changes.
"""

from __future__ import annotations

import re

VERSION = "progress/v2"

SYSTEM = """You are comparing one patient's medical reports between their last
visit and today's visit. Both sets have already been summarised; you are reading
those summaries, not the original documents.

Produce a short trajectory a doctor can absorb in a few seconds before the
patient sits down.

Rules — follow these exactly:

- The message below tells you exactly which measurements are COMPARABLE (a
  value at both visits) and which are NEW THIS VISIT (no earlier value). Respect
  that split absolutely.
- A NEW THIS VISIT measurement has nothing to compare against. Never say it
  "rose", "increased", "worsened" or "improved" — there is no earlier number to
  have moved from. Report it in current_status as a new finding, and in
  watch_points if it needs attention.
- trends: one entry per COMPARABLE measurement, using its exact label. For each,
  give interpretation: "better" / "worse" / "unclear" — what the movement means
  for the patient, which is not the same as which way the number went. A falling
  creatinine is better; a falling haemoglobin is worse. Use "unclear" when you
  are not certain. Never add a trend for anything not listed as comparable.
- improvements / deteriorations: one short line each, phrased as
  "Haemoglobin 9.1 -> 11.4 g/dL". Only for things you could justify from the two
  summaries. Leave a list empty rather than padding it.
- unchanged: findings present in both visits that did not move.
- current_status: where the patient stands today, from the current visit alone.
  This is the right home for a new finding that has nothing to compare against.
  It must NOT repeat summary. If you find yourself writing the same sentence in
  both, the summary is about the change and current_status is about today's
  findings — put different content in each.
- status: the overall direction. Use "unclear" whenever the two visits share no
  comparable measurement — that is a normal answer, not a failure.
- When nothing is comparable, say so ONCE, in a single short clause, and spend
  the rest of summary on what today's reports actually show. Do not write two
  sentences that both amount to "there is nothing to compare"; a doctor reading
  that has learned nothing from the card.
- summary: two to four sentences. What changed, what it means, what to look at
  today. Do not list every value again; the lists already carry them.
- watch_points: what the doctor should keep an eye on. Omit rather than invent.

Never state a diagnosis. Never invent a value, a test or a date. Never describe
a change you cannot point to in both summaries. If the two visits genuinely
cannot be compared, say so plainly in summary, set status to "unclear", and
leave the lists empty.

Worked example. Haemoglobin is COMPARABLE (9.1 -> 11.4); creatinine is NEW THIS
VISIT at 1.6 with no earlier value.

WRONG — summary: "Haemoglobin has improved, but creatinine has worsened,
indicating potential kidney issues."
  Two faults. Creatinine cannot have "worsened" with nothing to compare it to,
  and "indicating kidney issues" is a diagnosis.

RIGHT — summary: "Haemoglobin has risen from 9.1 to 11.4 g/dL, though it remains
below range. Creatinine is raised at 1.6 mg/dL; this is the first reading, so
there is no trend yet."
  current_status: "Anaemia improving. Creatinine above range on first measurement."
  watch_points: ["Repeat creatinine to establish whether 1.6 mg/dL is a trend."]"""

USER_TEMPLATE = """Patient: {patient}

PREVIOUS VISIT — {previous_date}
{previous_block}

CURRENT VISIT — {current_date}
{current_block}

{comparability}

Compare the current visit against the previous one."""


def _describe_patient(patient: dict) -> str:
    bits = []
    age = patient.get("age")
    if age is not None:
        bits.append(f"{age} years")
    gender = (patient.get("gender") or "").strip()
    if gender:
        bits.append(gender)
    return ", ".join(bits) if bits else "no demographics given"


# Labs name the same analyte differently, and two visits to the same clinic can
# easily be reported by two labs. "Fasting Blood Sugar" and "Glucose, Fasting,
# Plasma" are one measurement; matching label strings literally declares them
# unrelated and silently throws the trend away.
#
# Deliberately a short, explicit table of well-established synonyms rather than
# fuzzy matching. Merging two analytes that are NOT the same — total versus
# direct bilirubin, urea versus BUN — would invent a trend across different
# tests, which is far worse than missing one. Anything not listed here still
# has to match on its own words.
_SYNONYM_GROUPS: list[tuple[str, ...]] = [
    (
        "fasting glucose",
        "fbs",
        "fasting blood sugar",
        "fasting blood glucose",
        "fasting plasma glucose",
        "glucose fasting",
        "glucose fasting plasma",
        "plasma glucose fasting",
        "sugar fasting",
    ),
    (
        "random glucose",
        "rbs",
        "random blood sugar",
        "random blood glucose",
        "random plasma glucose",
    ),
    (
        "postprandial glucose",
        "ppbs",
        "post prandial blood sugar",
        "post prandial glucose",
        "pp blood sugar",
    ),
    ("hba1c", "a1c", "glycated haemoglobin", "glycated hemoglobin",
     "glycosylated haemoglobin", "glycosylated hemoglobin"),
    ("haemoglobin", "hemoglobin", "hb"),
    ("creatinine", "serum creatinine"),
    ("tsh", "thyroid stimulating hormone"),
    ("vitamin d", "25 hydroxy vitamin d", "25 oh vitamin d", "vitamin d3"),
    ("vitamin b12", "b12", "cobalamin"),
    ("total cholesterol", "cholesterol total"),
    ("uric acid", "serum uric acid"),
]

_WORD = re.compile(r"[^a-z0-9]+")


def _tokens(label: str) -> str:
    """Label reduced to its words, order-insensitive.

    Only case, punctuation and word order are treated as noise — "Bilirubin,
    Total" and "Total Bilirubin" are the same test, while "Bilirubin-Total" and
    "Bilirubin-Direct" stay firmly apart because no word is ever dropped.
    """
    words = [w for w in _WORD.split(label.lower()) if w]
    return " ".join(sorted(words))


_ALIASES: dict[str, str] = {}
for _group in _SYNONYM_GROUPS:
    _canonical_name = _group[0]
    for _alias in _group:
        _ALIASES[_tokens(_alias)] = _canonical_name


def canonical_label(label: str) -> str:
    """The key two visits' labels must share to count as the same measurement."""
    key = _tokens(label)
    return _ALIASES.get(key, key)


def _labels(reports: list[dict]) -> dict[str, str]:
    """Measurement label -> value, for one visit."""
    out: dict[str, str] = {}
    for r in reports:
        for a in r.get("abnormal_values") or []:
            label = (a.get("label") or "").strip()
            if label:
                out[label] = a.get("value") or ""
    return out


def comparable_labels(
    previous: list[dict], current: list[dict]
) -> list[tuple[str, str, str]]:
    """(label, previous_value, current_value) for everything measured twice.

    Derived from the data, not from the model — this is what the trends table is
    built from, so an invented comparison cannot reach the doctor.
    """
    prev, curr = _labels(previous), _labels(current)
    by_canonical = {canonical_label(k): (k, v) for k, v in prev.items()}
    pairs = []
    for label, current_value in curr.items():
        hit = by_canonical.get(canonical_label(label))
        if hit:
            pairs.append((label, hit[1], current_value))
    return pairs


def _render_comparability(previous: list[dict], current: list[dict]) -> str:
    """Spell out what may be compared, so the model does not have to infer it."""
    pairs = comparable_labels(previous, current)
    prev_labels = {canonical_label(k) for k in _labels(previous)}
    new_only = [
        f"{label}: {value}"
        for label, value in _labels(current).items()
        if canonical_label(label) not in prev_labels
    ]

    lines = []
    if pairs:
        lines.append("COMPARABLE (measured at both visits — these may be trends):")
        lines += [f"  - {l}: {p} -> {c}" for l, p, c in pairs]
    else:
        lines.append(
            "COMPARABLE: none. No measurement appears at both visits, so there "
            "is no trend to report — set status to \"unclear\"."
        )
    if new_only:
        lines.append("")
        lines.append(
            "NEW THIS VISIT (no earlier value — describe as new findings, "
            "never as changes):"
        )
        lines += [f"  - {n}" for n in new_only]
    return "\n".join(lines)


def _render_visit(reports: list[dict]) -> str:
    """One visit's reports, flattened into lines the model can compare."""
    if not reports:
        return "    (no report summaries for this visit)"

    lines: list[str] = []
    for i, r in enumerate(reports, 1):
        title = r.get("title") or f"Report {i}"
        summary = (r.get("summary") or "").strip()
        lines.append(f"[{i}] {title}")
        if summary:
            lines.append(f"    {summary}")
        for a in r.get("abnormal_values") or []:
            ref = f" (ref {a['reference']})" if a.get("reference") else ""
            direction = a.get("direction") or ""
            suffix = f" [{direction}]" if direction else ""
            lines.append(
                f"    - {a.get('label', '')}: {a.get('value', '')}{ref}{suffix}"
            )
        for f in r.get("key_findings") or []:
            lines.append(f"    * {f}")
    return "\n".join(lines)


def build_user(
    patient: dict,
    previous: dict,
    current: dict,
) -> str:
    previous_reports = previous.get("reports") or []
    current_reports = current.get("reports") or []
    return USER_TEMPLATE.format(
        patient=_describe_patient(patient),
        previous_date=previous.get("visit_date") or "date not recorded",
        previous_block=_render_visit(previous_reports),
        current_date=current.get("visit_date") or "date not recorded",
        current_block=_render_visit(current_reports),
        comparability=_render_comparability(previous_reports, current_reports),
    )
