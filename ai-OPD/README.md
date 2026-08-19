# ai-OPD — local inference sidecar

Everything the OPD system needs from AI, running entirely on your own machine.
No paid API, no request leaving the host.

| Job | What runs it |
|---|---|
| Speech → text | `faster-whisper` (CTranslate2), Hindi-capable checkpoint |
| Report summaries & prescription drafting | Ollama serving Qwen2.5-3B-Instruct |
| Reading scanned/photographed reports | `pdfplumber`, falling back to Tesseract OCR |

The NestJS backend calls this over `http://127.0.0.1:8000`. **Bind it to localhost
only** — it has no authentication of its own and is not meant to face the internet.

---

## Setup

### 1. Free up disk

Models need roughly 5 GB, and the HuggingFace cache plus LoRA checkpoints want
headroom on top. Check before you start:

```bash
df -h /
```

### 2. System dependencies

```bash
brew install python@3.12 ffmpeg tesseract tesseract-lang
```

- `ffmpeg` — Whisper decodes audio through it.
- `tesseract-lang` — brings the `hin` traineddata used for Hindi reports.
- Python 3.12 — the system Python 3.9 is too old for the modern stack.

### 3. Python environment

```bash
cd ai-OPD
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Ollama and the LLM

```bash
brew install ollama
brew services start ollama       # or: ollama serve
ollama pull qwen2.5:3b-instruct  # ~2 GB
```

### 5. Configure and run

```bash
cp .env.example .env             # edit if you want a different model
source .env                      # or use direnv / a process manager
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

First start downloads the Whisper weights, so it takes a minute. Then:

```bash
curl -s localhost:8000/health | python3 -m json.tool
```

`status: "ok"` means Whisper is loaded and Ollama is reachable. `"degraded"`
tells you which half is missing — the backend degrades gracefully either way
(uploads and consultations still work, they just don't get AI output).

---

## Endpoints

| Endpoint | Input | Output |
|---|---|---|
| `GET /health` | — | Model readiness and versions |
| `POST /transcribe` | `audio` file, optional `medicine_catalog` JSON array | `{text, language, duration_seconds}` |
| `POST /summarize-report` | `file` (PDF or image) | `{summary{...}, extraction_method}` |
| `POST /extract-prescription` | `{transcript, patient, medicine_catalog}` | `{prescription{...}}` |

Both LLM endpoints constrain decoding to a JSON schema (Ollama's `format`
parameter), so malformed output is not a failure mode the backend has to handle.

**Audio is never written to durable storage.** `/transcribe` writes the upload to
a temp file, transcribes it, and deletes it in a `finally` block.

---

## Choosing models

Set these in `.env`; no code changes are needed to move to better hardware.

| Setting | This laptop (M1, demo) | GPU server (production) |
|---|---|---|
| `WHISPER_MODEL` | `small` | `vasista22/whisper-hindi-medium` or `large-v3` |
| `WHISPER_DEVICE` | `cpu` | `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | `float16` |
| `LLM_MODEL` | `qwen2.5:3b-instruct` | `qwen2.5:7b-instruct` |

Rough M1 timings for a 15-minute consultation: `small` transcribes in about
4–8 minutes, then drafting the prescription takes ~20 seconds. That is why the
backend treats this as a background job the UI polls rather than a blocking call.

---

## Accuracy: what actually moves the needle

In order of impact, before any training:

1. **A Hindi fine-tuned Whisper checkpoint** rather than stock multilingual.
2. **The medicine vocabulary hint.** The backend passes the clinic's medicine
   catalogue on every transcription; Whisper conditions on it and stops
   mishearing drug names as ordinary words. This costs nothing and is the single
   biggest win for prescription quality.
3. **The catalogue in the extraction prompt**, so the model writes medicine names
   the way this clinic spells them.
4. **Fine-tuning** — see `finetune/README.md`.

## Deploying to a server

`Dockerfile` builds the service; Ollama runs as its own container or host
service. Point `OLLAMA_URL` at it. Keep both off the public network.
