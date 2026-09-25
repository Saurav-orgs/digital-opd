"""Speech-to-text — kept as the import path the rest of the service uses.

The implementation moved into the `app/stt/` package when Sarvam was added
alongside Whisper. This shim stays so that `from . import transcribe` and
`transcribe.transcribe(...)` keep meaning what they have always meant, in
main.py and in scripts/bench_stt.py alike.

See `app/stt/__init__.py` for the dispatcher and how a provider is chosen.
"""

from .stt import (  # noqa: F401
    aclose,
    atranscribe,
    is_loaded,
    last_rtf,
    load_model,
    record_rtf,
    transcribe,
    warm_up,
)
