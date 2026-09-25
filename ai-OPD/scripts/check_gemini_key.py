#!/usr/bin/env python
"""Confirm GEMINI_API_KEY works and show what one call would cost.

Run this before switching the report path over to Gemini — a key that fails
here will silently fall through to the local model during a real upload, and
the cost log will show nothing at all.
"""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"), override=False)

key = os.environ.get("GEMINI_API_KEY", "")
print(f"key: {'set' if key else 'MISSING'}  len={len(key)}  prefix={key[:4] if key else '-'}")
# Google issues more than one key format ("AIza..." and the newer "AQ.…"), so
# the shape says nothing about validity — only the call below does. An earlier
# version of this script guessed from the prefix and was wrong.
if key and not key.startswith(("AIza", "AQ.")):
    print("  note: unfamiliar key prefix — the call below is what decides.")

async def main():
    from app import gemini_llm
    from app.config import settings
    print(f"model={settings.gemini_model} enabled={settings.gemini_enabled} free_tier={settings.gemini_free_tier}")
    try:
        out = await gemini_llm.generate_json(
            system='Reply with JSON only: {"ok": true}',
            user="respond", schema={}, route="keycheck")
        print("OK — key works. Response:", out)
        print("\nA cost row was appended. See it with:")
        print("  .venv/bin/python scripts/cost_report.py --by provider")
    except Exception as err:
        print(f"FAILED: {str(err)[:300]}")
        sys.exit(1)

asyncio.run(main())
