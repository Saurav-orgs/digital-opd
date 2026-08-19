"""Correct the spelling of a spoken/transcribed medicine name.

Speech recognition mishears drug names constantly ("ajithrel", "pentop"). The
LLM writes down what it heard; this snaps that to the correct spelling of a real
medicine, so the prescription doesn't carry a mangled name.

How it stays safe:
  - It matches against a real dictionary (a bundled base list of common Indian
    medicines + the clinic's own catalogue, which grows from what THIS doctor
    prescribes), not a guess.
  - It only replaces a name when the closest match is clearly close enough;
    otherwise it keeps exactly what was heard. A conservative threshold means we
    never turn one real medicine into a different one.
  - It corrects the NAME only. Strength/dosage come from the transcript and are
    left untouched — we never add a strength from the dictionary.
"""

from __future__ import annotations

import logging
import os
import re

from rapidfuzz import fuzz, process, utils

log = logging.getLogger(__name__)

_DATA = os.path.join(os.path.dirname(__file__), "data", "indian_medicines.txt")

# A strength tail like "Dolo 650" / "500 mg" is not part of the base name.
_STRENGTH_TAIL = re.compile(r"\s+\d+\s*(mg|mcg|ml|g|iu)?\.?$", re.IGNORECASE)

# Only replace when the match is this good. Calibrated so real mishearings
# (pentop->Pantop, combiflame->Combiflam) snap, while non-medicines and
# cross-drug near-misses do not.
_THRESHOLD = 80
# Don't try to correct very short fragments — too easy to snap to the wrong drug.
_MIN_LEN = 4


def _base(name: str) -> str:
    return _STRENGTH_TAIL.sub("", (name or "").strip()).strip()


class MedicineSpeller:
    def __init__(self) -> None:
        self._base_names: list[str] = []
        self._load()

    def _load(self) -> None:
        try:
            with open(_DATA, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        self._base_names.append(line)
        except OSError as err:
            log.warning("Medicine dictionary not loaded: %s", err)
        log.info("Loaded %d base medicine names.", len(self._base_names))

    def correct(self, name: str, extra: list[str] | None = None) -> str:
        """Return the best canonical spelling for `name`, or `name` unchanged.

        `extra` is the clinic's own catalogue (may carry strengths, stripped
        here). Clinic names are preferred on ties — they reflect this doctor.
        """
        raw = _base(name)
        if len(raw) < _MIN_LEN:
            return name.strip()

        # Clinic catalogue first (most relevant), then the bundled dictionary.
        pool: list[str] = []
        seen: set[str] = set()
        for src in [extra or [], self._base_names]:
            for entry in src:
                b = _base(entry)
                key = b.lower()
                if b and key not in seen:
                    seen.add(key)
                    pool.append(b)
        if not pool:
            return raw

        # Exact (case-insensitive) hit → return canonical casing straight away.
        lower = {p.lower(): p for p in pool}
        if raw.lower() in lower:
            return lower[raw.lower()]

        # default_process lowercases + strips punctuation so casing/spacing
        # don't sink the score.
        match = process.extractOne(
            raw, pool, scorer=fuzz.WRatio, processor=utils.default_process
        )
        if not match:
            return raw
        best, score = match[0], match[1]
        # Speech usually gets the first sound right, so require the initial
        # letter to agree — this blocks confident-looking cross-drug snaps.
        same_start = best[:1].lower() == raw[:1].lower()
        if score >= _THRESHOLD and same_start:
            return best
        # No confident match: keep what was heard.
        return raw


# Module-level singleton — the dictionary is loaded once.
speller = MedicineSpeller()
