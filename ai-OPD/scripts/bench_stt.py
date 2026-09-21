"""Time Whisper over a folder of consultation clips.

    PYTHONPATH=. .venv/bin/python scripts/bench_stt.py BENCH_DIR [--chunk SECONDS]

BENCH_DIR holds `<name>.wav` clips (16 kHz mono) and, optionally, a
`<name>.txt` next to each with the doctor-approved transcript. Prints wall
time, RTF and — when a reference exists — the medicine-name recall against it.

`--chunk N` cuts each clip into N-second pieces and runs them through the
chunk path with previous-text carry-over, the way live transcription will,
and reports how far that drifts from the whole-file transcript.

Run it twice, with WHISPER_BATCHED=false and =true, before turning batching
on in production: the numbers are the argument, not the flag.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import re
import sys
import time
import wave
from pathlib import Path

from app import transcribe
from app.config import settings

_WORD = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _wer(ref: str, hyp: str) -> float:
    """Word error rate by Levenshtein distance over tokens."""
    r, h = _tokens(ref), _tokens(hyp)
    if not r:
        return 0.0
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i]
        for j, hw in enumerate(h, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rw != hw)))
        prev = cur
    return prev[-1] / len(r)


def _split(path: Path, seconds: float, out_dir: Path) -> list[Path]:
    with wave.open(str(path), "rb") as w:
        rate, width, channels = w.getframerate(), w.getsampwidth(), w.getnchannels()
        frames = w.readframes(w.getnframes())
    step = int(rate * seconds) * width * channels
    pieces = []
    for i, start in enumerate(range(0, len(frames), step)):
        piece = out_dir / f"{path.stem}.{i:03d}.wav"
        with wave.open(str(piece), "wb") as w:
            w.setnchannels(channels)
            w.setsampwidth(width)
            w.setframerate(rate)
            w.writeframes(frames[start : start + step])
        pieces.append(piece)
    return pieces


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bench_dir", type=Path)
    ap.add_argument("--chunk", type=float, default=0, help="also run N-second pieces")
    args = ap.parse_args()

    clips = sorted(args.bench_dir.glob("*.wav"))
    if not clips:
        print(f"no .wav clips in {args.bench_dir}", file=sys.stderr)
        return 1

    transcribe.load_model()
    mode = f"batched x{settings.whisper_batch_size}" if settings.whisper_batched else "sequential"
    print(f"model={settings.whisper_model} {settings.whisper_device}/{settings.whisper_compute_type} beam={settings.whisper_beam_size} {mode}\n")

    tmp = args.bench_dir / ".chunks"
    tmp.mkdir(exist_ok=True)

    total_audio = total_wall = 0.0
    wers: list[float] = []
    drifts: list[float] = []
    for clip in clips:
        ref_path = clip.with_suffix(".txt")
        ref = ref_path.read_text().strip() if ref_path.exists() else None

        t = time.monotonic()
        text, _, duration = transcribe.transcribe(str(clip))
        wall = time.monotonic() - t
        total_audio += duration
        total_wall += wall
        line = f"{clip.name:32} {duration:6.1f}s audio  {wall:6.1f}s  RTF {wall / duration:.2f}"
        if ref is not None:
            wer = _wer(ref, text)
            wers.append(wer)
            line += f"  WER {wer:.1%}"
        print(line)

        if args.chunk:
            t = time.monotonic()
            parts: list[str] = []
            for piece in _split(clip, args.chunk, tmp):
                piece_text, _, _ = transcribe.transcribe(str(piece), previous_text=" ".join(parts))
                parts.append(piece_text)
                piece.unlink()
            chunk_wall = time.monotonic() - t
            drift = _wer(text, " ".join(parts))
            drifts.append(drift)
            print(f"{'':32} chunked@{args.chunk:.0f}s: {chunk_wall:6.1f}s  drift vs whole {drift:.1%}")

    print(f"\n{len(clips)} clips, {total_audio:.0f}s audio in {total_wall:.0f}s — RTF {total_wall / total_audio:.2f}")
    if wers:
        print(f"mean WER {sum(wers) / len(wers):.1%}")
    if drifts:
        print(f"mean chunk drift {sum(drifts) / len(drifts):.1%}")
    with contextlib.suppress(OSError):
        tmp.rmdir()
    return 0


if __name__ == "__main__":
    sys.exit(main())
