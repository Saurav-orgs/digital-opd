# Fine-tuning the prescription model

Everything here is free and runs locally. The honest position on each model:

| Model | Approach | Why |
|---|---|---|
| **Speech → text** | Use an already fine-tuned Hindi checkpoint. **Do not train.** | Training Whisper needs tens of hours of transcribed Hindi clinical audio you don't have, and it will not train on this laptop. `vasista22/whisper-hindi-medium` and AI4Bharat's IndicWhisper are already fine-tuned on large Hindi corpora and will beat anything trainable from zero. Set `WHISPER_MODEL` and you have the win. |
| **Prescription drafting** | LoRA fine-tune, starting now on synthetic data, then on your real corrections. | This is a format-and-extraction task, which is exactly what a small model learns well from a few thousand examples. |

Before any of this, the two changes that improve accuracy most cost nothing and
are already wired in: the medicine-vocabulary hint passed to Whisper, and the
catalogue passed to the drafting prompt.

---

## Round 1 — synthetic (do this now)

```bash
pip install mlx-lm
python generate_dataset.py --out data --n 2500
python train_lora.py --iters 600          # a couple of hours on an M1
python evaluate.py --model qwen2.5:3b-instruct     # baseline first
```

`generate_dataset.py` builds templated Hinglish consultations: real code-switching,
the `1-0-1` dosage convention, and — importantly — **distractors**, where the
patient mentions a medicine that must *not* end up in the prescription. Every
field in a target is traceable to something actually said in its transcript, so
the data never teaches the model to invent.

What round 1 teaches is the shape of the task. It does not know how *your* doctor
speaks.

## Round 2 — your own data (the one that matters)

Every issued prescription stores the transcript the model saw alongside the
prescription the doctor signed off (`ai_training_samples`, written by
`PrescriptionsService.issue`). After a few hundred consultations:

```bash
pip install psycopg2-binary
DATABASE_URL=postgresql://user:pass@localhost:5432/digital-opd \
  python export_real_data.py --out data_real
# train on the union of data/ and data_real/
```

Rows where the doctor changed nothing are kept on purpose — they confirm what the
model already gets right.

## Deciding whether to ship an adapter

```bash
python evaluate.py                          # base
python evaluate.py --model <adapter-served-model>
```

Four metrics, chosen because they are the clinically meaningful ones:

- `medicine_precision` — **the one to protect.** Every point lost here is an
  invented medicine that could reach a patient if the doctor skims the draft.
- `medicine_recall` — missed medicines are far safer; the doctor adds them.
- `dosage_exact`, `diagnosis_exact` — how much typing the doctor is spared.

**Keep the adapter only if precision holds and recall improves.** If precision
drops, discard it: a model that misses things is a nuisance, a model that
fabricates them is a hazard.

To serve an adapter, point `LORA_ADAPTER_PATH` at it (or serve the merged model
through Ollama and set `LLM_MODEL`). Unsetting it falls straight back to the base
model, so rollback is one env var.

## Reality check

A 3B model doing extraction from noisy Hinglish speech will not be perfect, and
fine-tuning does not make it perfect. The design assumes this: the doctor reviews
and edits every draft, issuing is an explicit action, and the prompt is written to
leave fields blank rather than guess. Fine-tuning reduces how much the doctor has
to correct; it never removes the need to look.
