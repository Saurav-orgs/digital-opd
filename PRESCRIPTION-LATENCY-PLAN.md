# Voice prescription latency — analysis and plan

**Symptom:** from the moment the doctor presses Stop to the draft appearing —
~15 s on the laptop, ~30–40 s on production.

**Scope of this document:** the analysis, plus a running record of what has
been done. Items marked **[done]** are in the working tree; items marked
**[server]** are environment changes that have to be made on the production box
and cannot be made from the repository.

**Status, 2026-09-22:** §3.1 checked — streaming is on in production, so the
upload fallback is *not* the cause. §3.2 and §5 implemented. Everything else
still waits on the §2 measurements.

---

## 1. Where the time actually goes

The wait after Stop is the sum of exactly three things:

| # | Stage | Where | Same on prod? |
|---|-------|-------|----------------|
| A | Whatever audio has **not** been transcribed yet when Stop is pressed | `ai-OPD` Whisper, CPU | **No — much worse on prod** |
| B | The Claude extraction call | `ai-OPD` → Anthropic API | Yes (roughly) |
| C | Draft save + the client noticing | backend + socket/poll | ~1–2 s either way |

B is the floor both environments share. A is the entire prod-vs-local gap.

### 1.1 Stage B — the Claude call (the ~15 s you see locally)

[app/claude_llm.py](ai-OPD/app/claude_llm.py) + [_EXTRACT_KW in app/main.py:1395](ai-OPD/app/main.py:1395):

- model `claude-opus-5`, **thinking adaptive and on by default** (Opus 5 thinks
  unless told otherwise — the code never passes `thinking`, so it does),
- `effort = "medium"` (`AI_CLAUDE_EXTRACT_EFFORT`),
- `max_tokens = 4000`, **non-streaming** — so nothing comes back until the
  whole answer, thinking included, is generated,
- structured output constrained to `PRESCRIPTION_JSON_SCHEMA`,
- system prompt 9 020 chars ≈ 2.3 k tokens, cached; user message = up to 120
  catalogue names + the transcript.

The input is small; the wall time is **thinking tokens + output tokens at Opus
output speed**. That is the ~15 s floor, and it is paid on every consultation
whatever the hardware. The one call a doctor waits on with a patient in the
room is currently the most expensive reasoning configuration in the codebase.

Post-processing after the call ([main.py:1560](ai-OPD/app/main.py:1560) onward —
spellfix, the grounding guards, follow-up reconciliation) is regex and
rapidfuzz over a handful of names: milliseconds. Not a suspect.

### 1.2 Stage A — Whisper, and why prod is different

Live transcription is supposed to make A ≈ 0: pieces are transcribed while the
doctor is still talking, so only the last few seconds remain at Stop. That
holds **only while Whisper keeps up with real time.** It does on the M1. Four
things in the current setup say it very likely does not on the server:

1. **One model, one at a time, for the whole box.**
   `WHISPER_POOL_SIZE=1` → the pool holds one model and
   `_TRANSCRIBE_SLOT = Semaphore(1)` ([main.py:111](ai-OPD/app/main.py:111)).
   Every segment of every doctor queues on that one slot. Locally there is one
   doctor; on prod a second recorder doubles A for both of them.

2. **Short segments are enormously expensive per second of audio.**
   The worklet cuts a piece after 3 s of speech + 600 ms of silence
   ([segmenter.worklet.js:26](admin-OPD/src/lib/audio/segmenter.worklet.js:26)).
   Whisper pads **every** input to a 30-second window, so a 3-second piece
   costs nearly what a 20-second piece costs. A doctor who pauses between
   sentences generates 15–20 pieces per minute, each paying the full window.
   The code comment on `/transcribe-chunk` already notes this; the segmenter
   was tuned for the live-text display, which is now gone (see §1.4).

3. **Decoding is at its most expensive setting.** `beam_size=5`, `best_of=5`,
   `WHISPER_BATCHED=false` ([transcribe.py:196](ai-OPD/app/transcribe.py:196)).
   Deliberate, and justified in the comments — but it triples the cost of
   point 2.

4. **The box is shared.** One uvicorn worker, one pm2 process, on a server the
   deploy workflow itself describes as hosting many unrelated apps. Whisper
   threads default to `min(4, cores/pool)` — on a 2-vCPU instance that is 2
   threads. And a report upload running OCR at the same time
   (`_OCR_SLOTS = 2`) competes for the same cores.

If the real-time factor on prod is ≥ ~0.9, the queue never drains while the
doctor is speaking and the backlog at Stop is tens of seconds. **This is the
prod-only 15–25 s.** It is also directly measurable — see §2.

### 1.3 Stage C — delivery

The socket pushes `draft_ready` immediately, so this is small. The 2-second
poll ([ConsultationRecorder.tsx:94](admin-OPD/src/components/ConsultationRecorder.tsx:94))
only matters on the upload fallback path. Streaming was suspected here and has now been
ruled out — see §3.1.

### 1.4 One thing that changed the trade-off

The working tree removes the live transcript from the recorder UI
(`ConsultationRecorder.tsx`, deliberate — half-heard names read as a verdict).
The 3-second segment length existed to make text appear quickly. **Nobody sees
that text any more**, so segment length is now free to be chosen purely for
throughput. This is the cheapest real win available.

---

## 2. Measure before changing anything

Every number needed is already logged. On the server:

```bash
pm2 logs opd-ai --lines 500 --nostream | grep -E "RTF|extract-prescription|Claude claude"
```

- `transcribe-chunk#N: 3.2s audio in 4.1s (RTF 1.28)` → stage A. **RTF is the
  single number that decides whether the prod gap is Whisper.** Anything ≥ 0.9
  confirms §1.2.
- `extract-prescription: claude drafted N chars in X.Xs` → stage B.
- `Claude claude-opus-5 effort=medium speed=standard: in=… cache_read=… out=…`
  → whether the prompt cache is being read (`cache_read=0` every time means the
  cached prefix is being invalidated) and how many output tokens are being
  generated.

Also worth capturing once:

```bash
nproc; free -g; curl -s 127.0.0.1:8000/health
grep -E "CONSULTATION_STREAMING|AI_ENABLED" /var/www/digital-opd/backend-OPD/.env
```

`/health` reports `whisper_rtf_last` directly.

The two benchmark scripts already in the repo are the change-control mechanism —
`scripts/bench_stt.py` for §3, `scripts/bench_extract.py` for §4. Both were
written for exactly this.

---

## 3. Fix the prod gap (stage A) — biggest win, no quality risk

Ordered by effect per unit of risk.

**3.1 Confirm streaming is on in prod. [done — it is on, nothing to change]**

Checked without needing server access, because the gateway's two refusals are
distinguishable from outside ([consultations.gateway.ts:64](backend-OPD/src/consultations/consultations.gateway.ts:64)):
a connection refused before the auth check says *"Live transcription is off on
this server."*, and one refused after it says *"Not signed in."* Connecting to
`/consultation` on production with no token returns:

```
connect_error: Not signed in.
```

That answer is only reachable past the `enabled` gate, so both `AI_ENABLED` and
`CONSULTATION_STREAMING` are true on the server. nginx also completes the
WebSocket upgrade (`101 Switching Protocols`), so the socket path is genuinely
in use.

**This rules out the single largest suspect.** Consultations on production are
being transcribed live, which means the 30–40 s is the live path failing to
keep up — §1.2 — and not the whole recording being transcribed after Stop. The
rest of §3 is therefore the real work, not a contingency.

To re-check this at any time:

```bash
node -e "const {io}=require('./admin-OPD/node_modules/socket.io-client');const s=io('https://api-digital-opd.devenvironment.space/consultation',{auth:{token:''},transports:['websocket'],reconnection:false});s.on('connect_error',e=>{console.log(e.message);process.exit(0)})"
```

**3.2 Make segments long. [done]** `minMs` raised from 3 000 to 10 000 in
[segmenter.worklet.js](admin-OPD/src/lib/audio/segmenter.worklet.js); `maxMs`
stays at 20 000 so no piece ever crosses Whisper's 30-second window.

Roughly a 3× cut in the number of encoder passes per consultation, at no
quality cost — longer context is *better* for Whisper, and the live text that
short pieces existed to feed is gone. Worth being explicit about why this does
not make the final wait worse, since the intuition says it should: the encoder
runs over a padded 30-second window whatever length you hand it, so the last
piece costs about the same at 10 s as it did at 3 s. What shrinks is the
backlog behind it, which is the part that was actually hurting.

Needs a doctor-app deploy to take effect (the worklet ships in the frontend
bundle, not on the server).

**3.3 Turn on batched decoding.** `WHISPER_BATCHED=true` — already wired, same
weights, documented as 2–4× on the same box. Gate it on `bench_stt.py` run
twice (`false` then `true`) over stored clips; ship it if word error rate and
medicine recall hold.

**3.4 Raise the pool on prod only.** `WHISPER_POOL_SIZE=2` (or 3) if the box has
≥ 4 cores and ~1 GB RAM spare per model. This does **not** speed up a single
consultation — the stream pump is serial per session by design — but it stops a
second doctor from doubling the first doctor's wait. Judge from the prod core
count in §2.

**3.5 Re-measure `beam_size`.** The comment in `config.py` says beam 1 dropped a
dosage sentence and is not worth it; it also says 2 costs ~10 % against 5. That
is a measurement worth repeating on the current prompt with `bench_stt.py`,
since 5 → 2 is a large saving at the exact point where the box is behind.
Change only if recall is unchanged on real clips.

**3.6 If RTF is still ≥ 1 after the above, it is a hardware problem, not a code
problem.** Options, in order of cost: give the sidecar dedicated vCPUs (its own
instance, away from the other apps on that box); move to a small GPU instance
(`WHISPER_DEVICE=cuda`, `large-v3-turbo`, `float16` — the Dockerfile already
takes a CUDA base image); or move STT to a hosted API. Do not raise the Whisper
model size on CPU.

---

## 4. Cut the floor (stage B) — the ~15 s both environments pay

All of these are env-var changes on the sidecar, no deploy, and all should be
judged with `scripts/bench_extract.py` over stored transcripts (it prints wall
time *and* medicine recall, which is the number that must not move).

**4.1 `AI_CLAUDE_EXTRACT_EFFORT=low`.** Effort controls how much Opus 5 thinks
before answering, and thinking is the bulk of this call's wall time. The task is
a schema-constrained extraction from a minute of speech, not a reasoning
problem — `low` is plausibly enough. Try it first; it is free and reversible.

**4.2 `AI_CLAUDE_FAST=true`.** Already implemented, including the 429 →
standard-speed retry. Same Opus 5 model at up to ~2.5× output tokens/second.
The cost is price: fast mode is billed at $10/$50 per MTok versus $5/$25. For a
draft of a few hundred output tokens that is a small absolute amount per
consultation — worth it if the seconds matter more than the cents. Note it
invalidates the prompt cache when toggled, and has its own rate limit.

**4.3 `AI_CLAUDE_EXTRACT_MODEL=claude-sonnet-5`.** The knob exists precisely to
A/B a faster model on this one route without touching the report summaries.
Sonnet 5 is materially faster and cheaper ($2/$10). This is a quality decision,
so it is yours to make on the bench numbers — but for a constrained extraction
with the grounding guards behind it, it is the most likely large win. Two
cautions: `trust_model` in `extract_prescription` is keyed on
`provider == "claude"`, which stays true for Sonnet, so the lighter guard set
still applies — correct, but worth knowing; and the bench must cover Hinglish
dictation and the new verbatim `previous_history` rule.

**4.4 Verify prompt caching is actually hitting.** The system prompt is the only
cached block and the medicine catalogue sits (deliberately) outside it. Watch
`cache_read` in the log line. Note the cache lives ~5 minutes, so in a clinic
with gaps between patients most calls will miss it regardless — that is a cost
issue more than a latency one, but it is the explanation if `cache_read=0`
looks alarming.

**4.5 Do not** turn on streaming for this call expecting a win. The draft is
useless partially rendered; streaming would only change where the time is spent,
not how much.

---

## 5. Small, free, do-anyway

- **Prefetch the medicine vocabulary. [done]** Both recording paths now fetch
  `vocabulary(doctor_id, 120)` once when the consultation opens and hand it to
  the draft, instead of querying again after the last segment is transcribed.
  `vocabulary(id, 120).slice(0, 60)` is exactly what `vocabulary(id, 60)`
  returned — same query, same ranking — so Whisper is biased with what it was
  before. `retryDraft` passes nothing and still fetches its own, as it must.
  Tens of milliseconds, but they were sitting squarely in the critical path.
- **Log the whole span. [done]** Both paths now log the number the doctor
  experiences, split where the time went:

  ```
  Live consultation <id>: stop → draft in 31.4s (transcribe tail 22.1s over 4 pending piece(s), draft 9.3s).
  Consultation <id> upload path: audio → draft in 44.0s (transcribe 33.8s, draft 10.2s).
  ```

  Read it as a diagnosis. A large tail with a backlog above 1 is transcription
  failing to keep up with live speech — that is §3 and the hardware. A large
  draft with a backlog of 0 or 1 is the extraction call — that is §4. The two
  were previously indistinguishable from outside the box.
- **Keep the 180-second "this is taking longer than usual" nudge** where it is;
  after the above it will stop appearing.

---

## 6. Expected outcome

If §2 shows RTF ≥ 0.9 on prod (the likely case):

| Change | Stage | Expected |
|---|---|---|
| Streaming confirmed on | A | removes the fallback-path worst case entirely |
| `minMs` 3 s → 10 s | A | ~3× less Whisper work per consultation |
| `WHISPER_BATCHED=true` | A | 2–4× on the remaining work |
| extract effort `low` | B | several seconds off the floor |
| fast mode **or** Sonnet 5 | B | the largest remaining cut, at a price/quality decision |

Target: Stop → draft in **under 10 s on prod**, with A back to near-zero where
live transcription was supposed to put it.

## 7. Order of work

1. ~~Confirm `CONSULTATION_STREAMING`~~ — **done, it is on** (§3.1).
2. ~~Span logging and the vocabulary prefetch~~ — **done** (§5).
3. ~~Segment length~~ — **done**, ships with the next doctor-app deploy (§3.2).
4. **Next:** read the prod logs (§2). The new span line plus `RTF` now answer
   the whole question in one grep, and decide whether §3 or §4 is where the
   remaining seconds are.
5. Then, on the server, in this order — each measured before the next:
   batching (§3.3), extraction effort (§4.1), fast mode or Sonnet 5 (§4.2/4.3),
   pool size (§3.4).
6. Hardware, only if RTF stays ≥ 1 after all of the above (§3.6).

### The server-side changes, ready to run [server]

None of these are in the repository — they are `.env` edits on the production
box, and each one needs the sidecar restarted. **Change one at a time and keep
the log line from §5 for each**, otherwise the measurement says nothing.

```bash
# On the server. The file the running sidecar actually reads:
#   /var/www/digital-opd/ai/.env
# Take a copy first so any of these is one command to undo.
cp /var/www/digital-opd/ai/.env /var/www/digital-opd/ai/.env.bak

# §4.1 — cheapest first: less thinking on the one call a patient waits on.
sed -i 's/^AI_CLAUDE_EXTRACT_EFFORT=.*/AI_CLAUDE_EXTRACT_EFFORT=low/' /var/www/digital-opd/ai/.env

# §3.3 — same Whisper weights, batched decoding. Bench it before it stays.
sed -i 's/^WHISPER_BATCHED=.*/WHISPER_BATCHED=true/' /var/www/digital-opd/ai/.env

# §4.2 — same Opus model, ~2.5x output speed, billed $10/$50 per MTok.
sed -i 's/^AI_CLAUDE_FAST=.*/AI_CLAUDE_FAST=true/' /var/www/digital-opd/ai/.env

# §4.3 — or instead of fast mode: a faster, cheaper model on this route only.
sed -i 's/^AI_CLAUDE_EXTRACT_MODEL=.*/AI_CLAUDE_EXTRACT_MODEL=claude-sonnet-5/' /var/www/digital-opd/ai/.env

# §3.4 — only if `nproc` shows 4+ cores and there is ~1GB RAM spare per model.
sed -i 's/^WHISPER_POOL_SIZE=.*/WHISPER_POOL_SIZE=2/' /var/www/digital-opd/ai/.env

pm2 restart opd-ai --update-env
```

The sidecar prints its resolved configuration on every start, so confirm the
change actually took rather than trusting the file:

```bash
pm2 logs opd-ai --lines 20 --nostream | grep "extraction:"
```

§4.1, §4.2 and §4.3 change what the model produces, not just how fast. Run
`scripts/bench_extract.py` over stored transcripts before and after each one
and compare medicine recall, not just wall time — a draft that comes back two
seconds sooner having lost a medicine is a worse outcome than the wait.
