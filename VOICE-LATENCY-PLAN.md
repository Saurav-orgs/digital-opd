# Voice Prescription Latency — Plan

**Problem:** the doctor speaks for 1 minute and waits ~1 minute for the draft.
**Target:** the transcript appears on screen *while* the doctor speaks; after
"Stop" the draft lands in **≤ 10 s**.

## Status (21 Sep 2026) — Phases 0–6 implemented ✅

Measured on this Mac (Whisper `small` CPU int8, Claude Opus 5 medium) with a
19 s TTS clip, streamed over the socket at real-time pace:

| | Result |
|---|---|
| Each piece transcribed | ~1.5 s after it lands (RTF 0.15–0.25) |
| After Stop → `drafting` | immediate (last piece already done) |
| After Stop → `draft_ready` | **7.9 s** (all of it the Claude call) |
| Same clip, upload path (fallback) | 3.3 s Whisper + 6.3 s Claude |
| Claude effort `low` vs `medium` | 6.0 s vs 10.0 s on the same transcript |

Verified in the browser: live transcript under the mic while "listening",
Stop → "Writing the draft…" → draft in the editor; with
`CONSULTATION_STREAMING=false` the recorder silently uploads the WAV instead;
a mic refusal creates no session; an abandoned session fails after 60 s with a
readable reason. Fast mode (`AI_CLAUDE_FAST`) is wired and falls back on 429 —
this key's fast-mode limit rejected the full-size extraction request, so it
stays off by default.

**Still to do on the production box:** run `scripts/bench_stt.py` with
`WHISPER_BATCHED` off and on (batched kept trailing sentences the sequential
path dropped in testing), and `scripts/bench_extract.py` across `low`/`medium`
and `claude-sonnet-5`; then set the env accordingly. Add the nginx `/socket.io/`
block from `backend-OPD/.env.example`.

Differences from the plan below: auth on the socket is a socket.io middleware
rather than `handleConnection` (the latter races the first message);
the mic is opened *before* the socket session so a refused mic leaves no row;
`recording` polls at 10 s while the socket is live.

## Where the 60 s go today (1 min of audio)

| Step | Where | Time | Why |
|---|---|---|---|
| Upload whole blob | `ConsultationRecorder.tsx` → `POST consultation/audio` | 1–2 s | Nothing is sent until Stop |
| Whisper | `ai-OPD/app/transcribe.py` — `small`, CPU, int8, beam 5 | **~40–50 s** | Roughly real-time on CPU; strictly after Stop |
| Claude draft | `ai-OPD/app/claude_llm.py` — Opus 5, effort **high** | **~10–20 s** | `.env` says `CLAUDE_EFFORT=medium` but code reads `AI_CLAUDE_EFFORT` → medium never applied |
| Poll + DB | 2 s `refetchInterval` | 0–2 s | |

Everything is serial: record → stop → upload → transcribe → draft.

## Decisions locked

- **STT stays Whisper (self-hosted) for now.** Sarvam / Google / Deepgram are a
  later phase; the streaming design below is STT-agnostic so swapping in a
  hosted streaming STT is a one-module change.
- **Segmentation happens in the browser** (it already holds the PCM; silence
  detection on RMS is cheap). The backend forwards segments, it does not cut
  audio.
- **Backend ⇄ ai-OPD stays HTTP** (one `POST /transcribe-chunk` per segment).
  ai-OPD stays stateless; the existing semaphore/pool logic still applies.
- **The old whole-file path stays** as the fallback when the socket drops or
  the browser cannot run an AudioWorklet. Same session row, same statuses.
- Every new behaviour sits behind an env flag so any phase can be rolled back
  by config alone.

---

## Phase 0 — Measure first (½ day)

We need numbers to prove each phase, not feelings.

- `ai-OPD/tests/bench/` — 15–20 real consultation clips (WAV, 30 s–4 min) and
  their doctor-approved transcripts + drafts. Stored outside git (S3/local),
  path via `BENCH_DIR`.
- `ai-OPD/scripts/bench_stt.py` — runs `transcribe()` over the set, prints
  wall time per clip, RTF (time ÷ audio length) and medicine-name WER against
  the reference.
- `ai-OPD/scripts/bench_extract.py` — runs `/extract-prescription` over stored
  transcripts with a chosen model/effort; prints latency and a medicine-list
  diff against the reference draft.
- Add timing logs to the pipeline so production numbers are visible:
  `consultations.service.ts` logs `transcribe_ms` and `draft_ms` per session;
  ai-OPD logs Whisper RTF per call and Claude `input/cache_read/output` tokens
  (already at debug — promote to info).

**Acceptance:** one table with today's baseline for STT and draft.

---

## Phase 1 — Claude step: config + flags (½ day)

Cheap wins on the drafting half. All in `ai-OPD/app/config.py`,
`ai-OPD/app/claude_llm.py`, `.env.example`.

1. **Fix the env key mismatch.** Rename live `.env` keys to `AI_CLAUDE_*`
   (`AI_CLAUDE_EFFORT`, `AI_CLAUDE_MODEL`, `AI_CLAUDE_TIMEOUT_SECONDS`,
   `AI_CLAUDE_MAX_TOKENS`). Log the resolved model + effort at startup so this
   cannot silently happen again.
2. **Per-route effort.** New `AI_CLAUDE_EXTRACT_EFFORT` (default `medium`) used
   only by `/extract-prescription`; summaries keep `high`. Bench `low` vs
   `medium` with `bench_extract.py`.
3. **Per-route model.** New `AI_CLAUDE_EXTRACT_MODEL` (default = `AI_CLAUDE_MODEL`).
   Lets us A/B `claude-sonnet-5` for extraction without touching summaries.
   `generate_json()` takes an optional `model` argument.
4. **Fast mode flag.** `AI_CLAUDE_FAST=true` switches the extraction call to
   `client.beta.messages.create(..., speed="fast", betas=["fast-mode-2026-02-01"])`
   (Opus 5 only; ~2.5× output speed at 2× price). On a 429 from the fast-mode
   rate limit, retry once without `speed` — same request otherwise. Off by
   default; ignored when the model is not Opus.
5. `max_tokens` for extraction down to `4000` — a draft never needs 8000, and a
   lower cap bounds the worst case.

**Acceptance:** draft step ≤ 8 s median on the bench set with the chosen
combination; medicine-list diff vs reference unchanged.

---

## Phase 2 — Whisper: faster on the same box (1 day)

`ai-OPD/app/transcribe.py`, `config.py`.

1. **`WHISPER_BATCHED=true`** — wrap each pooled model in
   `faster_whisper.BatchedInferencePipeline`; `WHISPER_BATCH_SIZE` (default 8).
   VAD-splits the audio and decodes segments in parallel. Same `initial_prompt`,
   beam and thresholds. Bench against the plain path: RTF and WER, and
   specifically re-check the "dropped dosage sentence" case noted in
   `config.py` — the beam-size measurement was done on the non-batched path.
2. **`WHISPER_POOL_SIZE=2`** on the production box (needs ~1 GB RAM each) so
   two doctors recording at once do not queue.
3. Document the GPU profile in `.env.example`
   (`WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16`,
   `WHISPER_MODEL=large-v3-turbo`) and make the Dockerfile accept a
   `BASE_IMAGE` build arg so a CUDA image can be built without a second file.

**Acceptance:** RTF ≤ 0.5 on the bench set on the production CPU (i.e. 1 min
of audio in ≤ 30 s), WER not worse than baseline. This headroom is required
for Phase 4 — streaming only works if each segment is transcribed faster than
it was spoken.

---

## Phase 3 — ai-OPD: segment transcription endpoint (1 day)

`ai-OPD/app/main.py`, `transcribe.py`, `schemas.py`.

**`POST /transcribe-chunk`** (multipart)

| field | type | notes |
|---|---|---|
| `audio` | file | 16 kHz mono 16-bit WAV, 2–25 s |
| `seq` | int | segment index, echoed back |
| `previous_text` | str | last ~200 chars of the transcript so far |
| `medicine_catalog` | JSON list | as today |

Response: `{ seq, text, duration_seconds, model_version }`.

- `transcribe()` gains an optional `previous_text` that is appended to the
  vocabulary prompt (`initial_prompt = vocab + " " + previous_text_tail`).
  Whisper conditions on it as if it preceded the audio, so "500" after a cut
  still attaches to "Dolo". Keep the whole prompt under ~220 tokens: trim the
  vocabulary list first, never the previous text.
- Same semaphore as `/transcribe`; same never-persist-audio rule.
- Short clips are padded to 30 s by Whisper, so segment cost is roughly fixed
  per call — the frontend's segment length (Phase 5) is tuned with this in mind.
- Unit tests: a 60 s bench clip split at silences → chunked transcript vs
  whole-file transcript, WER delta reported.

**Acceptance:** chunked transcript of a bench clip within 2 % WER of the
whole-file transcript; a 15 s segment returns in ≤ 6 s on the production CPU.

---

## Phase 4 — Backend: WebSocket gateway (1.5 days)

New: `backend-OPD/src/consultations/consultations.gateway.ts`,
`consultation-stream.service.ts`. Deps: `@nestjs/websockets`,
`@nestjs/platform-socket.io`, `socket.io`.

**Why socket.io over raw `ws`:** auth handshake, auto-reconnect with the same
session, binary frames and rooms out of the box; the frontend client is small.

**Namespace `/consultation`**, auth on connect via the JWT in
`handshake.auth.token` (reuse `JwtStrategy`'s verification, same permission
check as `POST consultation/audio`: `APPOINTMENTS:UPDATE`).

Events (client → server):

| event | payload | server action |
|---|---|---|
| `start` | `{ appointmentId }` | destroy previous session for the appointment (as today), create row with new status **`recording`**, join room, reply `started { sessionId }` |
| `segment` | `{ seq, wav: ArrayBuffer }` | enqueue for this session |
| `stop` | `{ totalSegments }` | mark stopping; when the queue has processed `totalSegments`, run `draftFromTranscript()` |
| `abort` | — | same as `DELETE consultation` |

Events (server → client):

| event | payload |
|---|---|
| `transcript` | `{ seq, text, transcript }` — the segment text and the full text so far |
| `status` | `{ status }` — `recording` → `transcribing` → `drafting` → `draft_ready` / `failed` |
| `error` | `{ message, fatal }` — `fatal: true` tells the client to fall back to the upload path |

**`ConsultationStreamService`** holds per-session in-memory state:
`{ queue, transcript, nextSeq, catalog, stopping, controller }`.

- Segments are processed **strictly in order** (one in flight per session) so
  the transcript never interleaves; a segment that arrives out of order waits
  for its predecessor. Uses `AiClientService.transcribeChunk()` (new method
  next to `transcribe()`).
- The transcript is written to the session row after every segment
  (`transcript`, `duration_seconds`), so a refresh mid-recording still shows
  the text, and `retryDraft` works unchanged.
- On `stop`, once drained: status `drafting`, then the existing
  `draftFromTranscript()` — no changes to drafting, merging, or cancel
  semantics. `inFlight` + `wasCancelled()` are reused for `abort`.
- Idle timeout: a session with no segment for 60 s and no `stop` is failed
  with a readable reason (browser closed, tab slept).
- **Single-instance assumption:** state is in-process, like `inFlight` is
  today. If the backend ever runs two instances, add the socket.io Redis
  adapter and move the queue to Redis — noted, not built now.

`ConsultationSessionStatus` gains `RECORDING = 'recording'`; the column is a
plain string, no migration. `GET consultation` and the poll path treat
`recording` like `transcribing` (in progress).

Config: `CONSULTATION_STREAMING=true` (gateway registered only when on);
`CORS`/`nginx` need the `Upgrade` headers for `/socket.io/`.

**Acceptance:** with a scripted client replaying a bench clip in 15 s segments
at real-time pace, the transcript events arrive within ~6 s of each segment,
the final draft lands ≤ 10 s after `stop`, and the stored session row equals
what the upload path would have stored.

---

## Phase 5 — Frontend: live capture + transcript (1.5 days)

`admin-OPD/src/components/ConsultationRecorder.tsx`, new
`admin-OPD/src/lib/audio/segmenter.worklet.ts`, `useConsultationStream.ts`,
`ConsultationTranscript.tsx`. Dep: `socket.io-client`.

**Capture:** `getUserMedia` (as today) → `AudioContext({ sampleRate: 16000 })`
→ `AudioWorkletNode` running the segmenter.

**Segmenter (in the worklet):**
- Accumulates Int16 PCM.
- Tracks RMS per 20 ms frame; a run of ≥ 600 ms below the noise floor after
  ≥ 3 s of speech closes a segment. A segment is force-closed at **20 s**
  regardless (a doctor who never pauses still gets live text; 20 s keeps the
  30 s-padding overhead reasonable — see Phase 3).
- Posts `{ seq, pcm }` to the main thread; the main thread wraps it in a
  44-byte WAV header and emits `segment` over the socket.
- Also keeps the full PCM so the whole recording can be uploaded via the old
  path if streaming fails.

**Hook `useConsultationStream(appointmentId)`** wraps the socket: `start()`,
`sendSegment()`, `stop()`, `abort()`, exposes `transcript`, `status`,
`lastError`. Writes `transcript`/`status` into the existing react-query
session cache (`['consultation', id]`) so `PrescriptionEditor` and the rest
of the page keep working off the same data and the 2 s poll becomes a
fallback rather than the source of truth.

**UI:**
- While recording: a live transcript panel under the mic button, text
  appended per segment, pulsing "listening…" on the last line.
- After Stop: panel shows "Writing the prescription draft…" and the existing
  `draft_ready` flow takes over — no change to the editor.
- **Fallback:** if the socket fails to connect, disconnects and cannot
  reconnect within 5 s, or the server sends `error { fatal: true }`, the
  recorder switches to the current whole-file path with the buffered PCM
  (WAV) and the same toast copy as today. `MediaRecorder` is no longer used
  when the worklet path is available; kept only for browsers without
  `AudioWorklet`.
- Cancel/retry flows unchanged; `abort` on the socket calls the same server
  logic as `DELETE consultation`.

**Acceptance:** on Chrome/Safari desktop, speaking for 1 min shows text within
~6 s of each pause, and the draft appears ≤ 10 s after Stop; killing the
backend mid-recording falls back to the upload path without losing audio.

---

## Phase 6 — Deploy + ops (½ day)

- nginx: `proxy_http_version 1.1; Upgrade/Connection` headers and a
  `proxy_read_timeout ≥ 600s` on `/socket.io/`.
- `docker-compose.yml`: `WHISPER_POOL_SIZE`, `WHISPER_BATCHED`, the
  `AI_CLAUDE_*` extraction vars, `CONSULTATION_STREAMING`.
- `ai-OPD/README.md` + `backend-OPD/.env.example`: document every new var
  and the rollback for each phase.
- A `/health` field on ai-OPD reporting `whisper_rtf_last` so a box that has
  fallen behind real time is visible before doctors notice.

---

## Rollback matrix

| Phase | Turn off with | Effect |
|---|---|---|
| 1 | `AI_CLAUDE_EXTRACT_EFFORT=high`, `AI_CLAUDE_FAST=false`, unset `AI_CLAUDE_EXTRACT_MODEL` | back to today's Claude call |
| 2 | `WHISPER_BATCHED=false` | plain `model.transcribe()` |
| 3 | nothing to turn off — endpoint is unused unless Phase 4 is on | |
| 4 | `CONSULTATION_STREAMING=false` | gateway not registered; client fails to connect and uses the upload path |
| 5 | same flag (client checks `/health` or the connect failure) | old recorder behaviour |

---

## Expected outcome

| | Today | After 1+2 | After 1–5 |
|---|---|---|---|
| Transcription wait after Stop | ~45 s | ~15–20 s | **~3–6 s** (last segment only) |
| Draft | ~15 s | ~5–8 s | ~5–8 s |
| **Doctor waits** | **~60 s** | **~20–25 s** | **~8–12 s**, transcript visible live |

A GPU or a hosted streaming STT later drops the "last segment" wait to ~1 s
without touching Phases 4–5 — only Phase 3's `transcribe()` changes.

## Order and estimate

| Phase | Days | Depends on |
|---|---|---|
| 0 Bench | 0.5 | — |
| 1 Claude flags | 0.5 | 0 |
| 2 Whisper batched | 1 | 0 |
| 3 Chunk endpoint | 1 | 2 (needs the headroom) |
| 4 WS gateway | 1.5 | 3 |
| 5 Frontend | 1.5 | 4 |
| 6 Deploy | 0.5 | 5 |
| **Total** | **~6.5 days** | |

Phases 1 and 2 ship on their own and are worth deploying before 3–5 are done.

## Out of scope (later)

- Sarvam / Google / Deepgram as the STT backend (plugs into Phase 3).
- Flutter admin app voice (web only today; the gateway is reusable).
- Multi-instance backend (Redis adapter for socket.io + shared segment queue).
- Streaming the draft JSON into the editor (perceived speed only).
