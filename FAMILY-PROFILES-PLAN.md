# Family patients + longitudinal combined summary

**Status: implemented.** Phases 1–6 are built across backend, AI service,
patient web, patient app, admin web and admin app. This document is the
as-built record; the "Decisions" table at the end lists what was locked and why.

Known limitation carried forward: the *structured* fields of the progress
summary (status chip, trends table, improvements/deteriorations) are grounded in
the report data and cannot contain a comparison the reports do not support. The
free-text narrative is not similarly constrained — the model still occasionally
phrases a single measurement as a change ("creatinine has risen") or edges
toward a diagnosis, despite explicit prompt rules and a worked example. That is
what the Phase 4 correction loop exists to fix once real doctor edits
accumulate.

---

Two linked requirements:

1. **One mobile number → many patients.** A person books for himself, his wife,
   his father. Same number, separate clinical records.
2. **The combined summary must span a patient's visits, not just one visit.**
   Shubham uploads 2 reports on visit 1; on visit 2 he uploads 2 more. The
   doctor reads one picture — what improved, what worsened, where he stands now
   — built only from *that* member's reports.

Per-report individual summaries stay exactly as they are.

---

## The identity rule (locked by the client)

- **The mobile number is an account, not a patient.** It owns zero or more
  patients.
- **There is no default / "self" patient.** Nothing is auto-created. Whoever is
  registered under a number is simply a patient of that number, all equal.
- **Identity is a `uniqueId`, never the name.** Two patients on the same number
  may have the identical name and are still two different patients.
- **Selection is explicit.** At booking, after the number is entered, the
  existing patients on that number are listed:
  - picks one → **existing patient**, this visit joins that record's history;
  - fills the details without picking → **new patient**, even if the name
    matches an existing one exactly.
- **Registering *is* creating a patient.** The number alone opens the account;
  the moment a details form is filled in, that data becomes exactly **one
  patient**. This holds on every path — self-booking, the standalone register
  screen, and the front desk's walk-in — so there is only one way a patient
  record is ever born.

**No merging, ever.** A wrong pick is undone by deleting, not by merging:

- Booked under the wrong patient → **delete the appointment** (allowed while the
  visit has not been consulted).
- Accidentally created a duplicate patient → **delete the patient**, allowed as
  long as that patient has **no completed OPD**.

Once any OPD is marked done, that patient record is permanent. The consequence
worth stating plainly: if a duplicate is only noticed *after* a consultation, the
history stays split and there is no recovery path. That is the accepted trade for
never silently combining two people.

---

## New booking flow

Today: *slot → [Step 1 details → Step 2 reports] → confirm.*

New: *slot → **Step 1 mobile** → Step 2 patient → Step 3 details → Step 4
reports → confirm.*

**Step 1 — Mobile (register/login).**
Enter the 10-digit number. The backend returns the patients already on it. A
number seen for the first time creates the account row silently — registration
is the number alone, no name, no password.

**Step 2 — Who is this visit for?**
A card per existing patient (name · age/gender · patient code · "last visit
10 Jun 2026"), plus a **"+ New patient"** card. Picking a card carries its
`patient_profile_id` forward; choosing "+ New patient" creates a new record on
submit.

**This step is skipped when the number has no patients yet** — a first-time
number goes straight from Step 1 to the details form, so a new user never sees
an empty picker. Guest and logged-in booking run the identical sequence; being
logged in only means Step 1 is pre-filled.

**Step 3 — Details, including the full address.**
Name, gender, age, then **address line, city, state, PIN code** — all required.
An existing patient arrives prefilled from their last visit and stays editable
(people move, ages change). A new patient starts blank.

**Step 4 — Reports.** Unchanged from today's Step 2.

### Walk-in is the same flow, run by the front desk

A walk-in **is a registration**. The admin's walk-in screen gets the same
mobile → pick-or-create → full-details sequence, and it creates the same account
and patient rows a self-booking would. The consequence that matters: a patient
who has only ever walked in **can log in later with that number and find the
visit, its reports and its prescription waiting for them** — no separate
sign-up, nothing to reconcile. So the address is required here too; the front
desk is capturing a registration, not a shortcut.

---

## Phase 1 — Schema & backfill

Migration `20260826000001-patient-profiles.js`.

**New table `patient_profiles`** — one row per real person:

| column | type | note |
|---|---|---|
| `id` | UUID pk | the internal uniqueId |
| `patient_code` | STRING unique | human-visible id, e.g. `PT-7K3M9Q` — Crockford base32, no ambiguous chars. What the doctor and front desk use to tell two same-named patients apart |
| `patient_id` | UUID → `patients.id` | the account (the mobile) |
| `name` | STRING | **not unique**, deliberately |
| `relation` | STRING null | `self` \| `spouse` \| `child` \| `parent` \| `other` — a label only, carries no privilege |
| `gender` | STRING null | |
| `dob` | DATEONLY null | optional; age still snapshotted per appointment |
| `address_line`, `city`, `state`, `pincode` | STRING null | the patient's current address, used to prefill the next booking |
| indexes | `(patient_id)`, `unique(patient_code)` | |

Note what is **absent**: no `is_self`, no unique constraint on
`(patient_id, name)`, no `merged_into_id`. All three would contradict the
identity rule.

**`patients` becomes a thin account row.** `name` goes nullable and stops being
required at registration — the name belongs to the profile now. `mobile` stays
unique.

**New FK columns** (nullable, `ON DELETE SET NULL`):
- `appointments.patient_profile_id` + index `(patient_profile_id, appointment_date)`
- `patient_reports.patient_profile_id` + index
- `notifications.patient_profile_id`

**Structured address on `appointments`.** The existing free-text
`patient_address` is **kept as the address line** — so nothing needs
backfilling — and three columns join it: `patient_city`, `patient_state`,
`patient_pincode` (STRING(6)). The appointment keeps its own copy as a
point-in-time snapshot, exactly as it already does for age and name.

**New columns on `appointments`** — the longitudinal summary:
- `progress_summary` JSONB
- `progress_summary_status` STRING null — `null` = no prior visits to compare
- `progress_summary_error` TEXT
- `progress_summary_visit_count` INTEGER default 0
- `progress_summarized_at` DATE

**New value on `AppointmentStatus`:** `cancelled`. The slot's partial unique
index only covers `confirmed`, so cancelling frees the slot without a hard
delete and keeps the audit trail.

**Backfill — deliberately minimal, because the system is not live.** Every row
in the database today is dummy test data the client has confirmed is expendable.
That removes the hardest part of this whole plan: there is no production
history to reconstruct, so the migration does not have to guess which family
member an old pathlab report belonged to.

1. Create the missing `patients` account for every distinct mobile in
   `appointments` / `patient_reports`.
2. Per account, group existing appointments by `lower(trim(patient_name))` →
   one profile per distinct name, `patient_code` generated, address copied from
   the most recent booking. The name is used *once*, here; never again at
   runtime.
3. `appointments.patient_profile_id` ← its group's profile.
4. `patient_reports` **with** `appointment_id` ← that appointment's profile.
5. `patient_reports` **without** one (old pathlab uploads keyed only by mobile)
   → **deleted**, along with their S3 objects. Same for orphan notifications.

**Scope this removes** versus an in-production migration: no dry-run preview
script, no "Unassigned reports" re-assign queue in the admin, and no
compatibility shim for app builds that predate `profile_id` — the parameter is
simply required from day one. If the client ever needs this migration to run
against real data later, steps 5 and the shim come back; nothing else changes.

---

## Phase 2 — Backend

### Profiles

**`PatientProfilesService`**
- `listForAccount(patientId)` — ordered by most recent visit.
- `assertOwned(patientId, profileId)` — throws `NOT_FOUND` when the profile is
  not on this account. Called by **every** endpoint taking a `profile_id`; an id
  from the client is never trusted.
- `createForAccount(patientId, dto)` — always creates, never dedupes. That is
  the rule.
- `generatePatientCode()` — retry-on-collision.

**Endpoints**
- `POST /patient/auth/identify` — `{ mobile }` → `{ patients: [...] }`. Creates
  the account if absent. Public, and it returns the patients in full — the
  client has accepted that a bare number reveals its roster until an OTP step
  exists. Worth rate-limiting (`@nestjs/throttler` is already a dependency) so
  the endpoint cannot be swept cheaply.
- `GET /patient/profiles`, `POST /patient/profiles`, `PATCH /patient/profiles/:id`
- `DELETE /patient/profiles/:id` — see the deletion rules below

### Deletion rules

**`DELETE /patient/appointments/:id`** (and the admin equivalent) — cancel a
booking made under the wrong patient.
- Allowed while `status = confirmed` **and** `consultation_status = pending`.
  Once the doctor has touched the visit (done / on_hold / rejected) it is a
  clinical record and stays.
- Sets `status = cancelled`, which frees the slot.
- Reports the **patient** uploaded for that visit are deleted with it — they
  already have that right today while a visit is open. Reports the **clinic**
  uploaded are detached (`appointment_id = NULL`) and land in the unassigned
  queue rather than being destroyed by a patient action.
- Writes a notification so the front desk sees the cancellation.

**`DELETE /patient/profiles/:id`** — remove a patient created by mistake.
- Allowed only when that profile has **no appointment with
  `consultation_status = done`**. One completed OPD makes the record permanent.
- Cascades: cancels any pending appointments (same path as above), deletes the
  profile's patient-uploaded reports and its notifications, detaches
  clinic-uploaded reports to the unassigned queue.
- Hard delete. With no completed clinical record there is nothing to preserve,
  and it keeps the patient picker clean — which is the whole point of the
  feature.
- Refused with a clear message otherwise: *"This patient has a completed OPD and
  can no longer be deleted."*

Both are also available to the doctor/front desk on the admin side, under the
same conditions, for walk-ins entered wrongly.

### Booking

- `CreateAppointmentDto` / `WalkInAppointmentDto` gain optional
  `patient_profile_id`. Present → validate ownership and use it. Absent → create
  a new profile from the details in the DTO. No name lookup, ever.
- Both DTOs gain `patient_city`, `patient_state`, `patient_pincode`, with
  `@Matches(/^[1-9]\d{5}$/)` on the PIN. Address fields are **required on every
  booking path, walk-ins included** — a walk-in is a registration.
- On booking, the profile's stored address is refreshed from what was submitted,
  so the next visit prefills correctly.

### Patient auth

- `POST /patient/auth/register` now collects the **same patient details as a
  booking** (name, gender, age/dob, full address) and creates the account plus
  **one** patient profile from them — consistent with every other path.
  `patients.name` is no longer written from here; the name is the profile's.
- `POST /patient/auth/login` simplifies. Today it back-fills a missing
  `patients` row from the last booking's name
  ([`patient-auth.service.ts:44`](backend-OPD/src/patient-auth/patient-auth.service.ts)).
  That guesswork goes away: booking and walk-in both create the account up
  front, so login only has to find it and issue the session. No account at all →
  "no patient registered on this number".
- After login the patient lands on their profile picker (one profile →
  auto-selected). A walk-in patient logging in for the first time simply finds
  the profile the front desk created.

### Scoping

- `appointments.history(mobile, user, excludeId)` →
  **`history(profileId, user, excludeId)`**; anchor on the reference
  appointment's `patient_profile_id`, keeping the existing "strictly earlier
  than this visit" logic. This alone satisfies requirement 1's history rule.
- `visitsForMobile()` → `visitsForProfile()`.
- `GET /patient/appointments?profile_id=` / `GET /patient/reports?profile_id=` —
  `profile_id` required; `all` gives a family view with each row tagged.
- `reports.listForMobile()` → `listForProfile()`.
- `POST /reports` (pathlab) requires `patient_profile_id`.
- `createByPatient` needs no change — it derives scope from the appointment.

**Patient portal entry.** With no default patient, after login: one profile →
auto-select it; several → a "Who are you viewing?" picker, remembered locally
and switchable from the header.

---

## Phase 3 — The combined summary, made longitudinal

The existing per-visit consolidation already works — it is only hidden in the
doctor's UI ([`AppointmentPage.tsx:176`](admin-OPD/src/pages/AppointmentPage.tsx)).
It is **kept as the building block**: cheap, already correct, and the natural
per-visit cache the longitudinal pass reads from. What changes is that a second
pass runs across visits, and the doctor sees **one card**, not two:

> priors exist → show the longitudinal summary
> no priors (first visit) → show the per-visit summary

### AI service (`ai-OPD`)

New endpoint **`POST /summarize-progress`**, new prompt module
`app/prompts/progress.py`, `VERSION = "progress/v1"`.

Request:
```jsonc
{
  "patient": { "age": 34, "gender": "male" },
  "timeline": [
    { "visit_date": "2026-06-10", "phase": "previous",
      "reports": [ { "title": "CBC", "summary": "...",
                     "key_findings": [], "abnormal_values": [] } ] },
    { "visit_date": "2026-08-26", "phase": "current", "reports": [ ... ] }
  ]
}
```

Response (`ProgressSummary`):
```jsonc
{
  "status": "improving | stable | worsening | unclear",
  "summary": "2–4 sentences: the trajectory and where the patient stands today",
  "improvements":   ["Haemoglobin 9.1 → 11.4 g/dL"],
  "deteriorations": ["Creatinine 1.2 → 1.6 mg/dL"],
  "unchanged":      ["..."],
  "trends": [ { "label": "Haemoglobin", "previous_value": "9.1 g/dL",
                "current_value": "11.4 g/dL", "direction": "up",
                "interpretation": "better" } ],
  "current_status": "the standing picture from the latest reports",
  "watch_points": ["..."]
}
```

Prompt rules — a hallucinated "improving" is clinically dangerous, so these are
hard constraints, not style guidance:
- Compare **only** labels present in both an earlier and the current visit. A
  value seen once belongs to `current_status`, never to `trends`.
- Never infer a diagnosis; never invent or extrapolate a value.
- Nothing comparable → `status: "unclear"`, said plainly.
- Runs through the existing `contradiction_guard` so the narrative cannot
  contradict the deterministic value list.

Text in, text out — no OCR — so it is fast next to `/summarize-report`.

### Backend

`AiClientService.summarizeProgress(...)`, mirroring `consolidateSummaries`.

In `ReportSummaryService`, `buildProgressForAppointment(appointmentId)`:
1. Load the appointment → `patient_profile_id`, `doctor_id`.
2. Find **the single most recent earlier visit** for the same profile **and the
   same doctor**, not cancelled, with a summary ready.
3. No such visit → clear the columns, `status = null` (UI falls back to the
   per-visit card).
4. Otherwise call `/summarize-progress` with exactly two entries: that visit,
   then this one.

**Only the last visit is looked at — but nothing older is lost.** The prior
visit contributes its **`progress_summary`** when it has one, and its
`reports_summary` only when it was itself a first visit. Because visit 2's
progress summary already folded in visit 1, visit 3 inherits visit 1's picture
through it. The chain stays current in condensed form while every rebuild reads
exactly one prior row — no window to tune, no cost that grows with a long
patient history.

**Storage: Postgres, not a vector DB.** The lookup is "the one previous visit
for this profile and doctor" — a single indexed row fetch on
`(patient_profile_id, doctor_id, appointment_date)`. There is no similarity
search anywhere in this feature, so a vector store would add an extra service to
run and back up while answering a question the existing index already answers.
The `progress_summary` JSONB column alongside the existing `reports_summary` is
the whole storage design.

Wiring:
- Called at the tail of `consolidateForAppointment()` — the chain is
  *report summarised → visit consolidated → progress rebuilt* — and chained onto
  the same single-lane `enqueue()`, so the sidecar is never hit concurrently.
- The boot sweeper also picks up `progress_summary_status = pending|processing`.
- `POST /appointments/:id/progress-summary/retry` for the doctor's retry.
- Editing/deleting a report already re-triggers consolidation, so this refreshes
  for free. Cancelling a visit or deleting a patient drops those reports out of
  every later timeline the next time it rebuilds.

---

## Phase 4 — Training the summary model

`TrainingSampleKind.REPORT_SUMMARY` is already declared in the enum but nothing
writes it. The supervision loop is the missing half:

1. **Capture.** Give the doctor an **"Edit summary"** action on the combined
   card (and a ✓/✗ on the trend rows). Saving writes an `ai_training_samples`
   row: `input_payload` = the timeline sent to the model, `ai_output` = what it
   returned, `doctor_output` = the corrected text, `edited` = whether anything
   changed. Untouched summaries are saved too — they are confirmations the model
   was already right, exactly as `PrescriptionsService.issue` does today.
   New kind: `TrainingSampleKind.PROGRESS_SUMMARY`.
2. **Round 1 — synthetic.** Extend `finetune/generate_dataset.py` with a
   progress generator: templated two- and three-visit lab timelines with known
   deltas, plus **distractors** — a value present in only one visit that must
   *not* appear as a trend, and a visit pair with nothing comparable whose
   correct answer is `unclear`. This teaches the shape of the task and, more
   importantly, teaches restraint.
3. **Round 2 — real corrections.** Extend `finetune/export_real_data.py` with a
   `--kind progress_summary` exporter, then LoRA-train per the existing
   `finetune/README.md` two-round pattern once a few hundred summaries have
   accumulated. `evaluate.py` gains a progress metric: trend precision (invented
   trends are the failure that matters) and direction accuracy.

Until an adapter exists, `progress/v1` runs prompt-only — the feature does not
wait on training.

---

## Phase 5 — Patient surfaces (`patient-web-OPD`, `patient-OPD`)

- `BookingForm.tsx`: the new Step 1 (mobile) and Step 2 (patient cards +
  "+ New patient"), the address block in Step 3, step badge to "Step _n_ of 4".
  The existing kept-mounted-on-Back pattern extends to the new steps so typed
  details survive navigation.
- **Address block**: address line, city, state, PIN code — four plain text
  inputs, all typed by the patient. PIN is validated as 6 digits and nothing
  more: no postal lookup, no auto-fill of city/state.
- Patient switcher in the account nav: "Viewing: Shubham ▾".
- **My Visits / Reports / Notifications** filtered by the selected patient;
  empty states name them ("No reports for Meena yet").
- **Cancel booking** on an upcoming visit in My Visits, with a confirmation
  naming the patient and slot — the recovery path for a wrong pick.
- **Manage patients** screen: add, rename, edit address, and **delete** — the
  delete button disabled with an explanatory tooltip once an OPD is done.
- Notification rows tagged with the patient's name; unread badge account-wide.
- `patient-OPD` (Flutter) mirrors all of it.

---

## Phase 6 — Doctor surfaces (`admin-OPD`, `admin-app-OPD`)

- `AppointmentPage.tsx`: header shows **patient name + patient code + relation**,
  the full address, and "4th visit · previous 10 Jun 2026".
- **The combined summary card comes back**, now longitudinal: a status chip
  (Improving / Stable / Worsening / Unclear), the narrative, improvements vs
  deteriorations side by side, the trends table, watch points, "across N reports
  from M visits", plus **Edit** and **Retry**. Falls back to the per-visit
  summary on a first visit.
- History panel is profile-scoped — a father's visits stop appearing under his
  son's appointment — and **each previous-visit row becomes a link** to
  `/appointments/:id`, where the doctor sees that visit's own reports and its
  own summary. The rows already render date, status, notes and prescriptions;
  they just need wrapping in a `<Link>`, and a "← back to current visit" crumb
  so the doctor can return.
- **Walk-in modal becomes a registration form**: mobile → pick-or-create → full
  details including the address, same required fields as the patient's own
  booking. Worth a line of copy in the modal telling the front desk the patient
  can log in with this number afterwards.
- **Cancel appointment** action for the front desk, same conditions as the
  patient's.
- Appointment **list/search by mobile still shows every patient on the number**
  (the front desk needs that), each row carrying the patient code.
- `Pathlabs.tsx` / `Reports.tsx`: patient dropdown after the mobile lookup,
  required before upload — plus the **Unassigned reports** queue from the
  backfill.
- `admin-app-OPD` mirrors the appointment-detail changes.

---

## Rollout order

1+2 change no visible behaviour beyond correct scoping — ship them first and let
the backfill settle in production for a few days. 3 sits behind the existing
`ai.enabled` flag. 5+6 are the UI. 4 follows once real data exists.

---

## Decisions (all open questions closed)

| # | Question | Decision |
|---|---|---|
| 1 | Phone number reveals its patient roster at Step 1 | **Accepted for now.** Ship it unmasked; OTP comes later. Rate-limit the endpoint. |
| 2 | Guest booking flow | **Identical to the logged-in flow.** Step 2 auto-skips for a number with no patients. |
| 3 | Cancel vs. hard-delete an appointment | **Soft cancel** (`status = cancelled`). Frees the slot via the existing partial unique index, keeps the clinic's trace, and never blocks deleting the patient afterwards (only a *completed* OPD does that). The patient's button still reads "Delete". |
| 4 | How far back the summary looks | **The last visit only**, carried forward as a chain — see Phase 3. Stored in Postgres; no vector DB. |
| 5 | Cross-doctor trajectory | **Never.** Each doctor is a closed environment; every prior-visit lookup filters on `doctor_id`. |
| 6 | Previous visits from the current visit | **Clickable.** History rows link to that visit's page, showing its reports and its summary. |
| 7 | Patient code format | `PT-7K3M9Q` confirmed. |
| 8 | Old app builds | **Not a concern** — nothing is live. `profile_id` is required from day one. |

Settled earlier in the same discussion:

- PIN code is a **plain manual input** — no postal API, no auto-fill.
- A **walk-in is a full registration**; the patient can log in with that number
  afterwards, and the address is required there too.
- **Registering creates exactly one patient** from the details filled in, on
  every path.
- **No merge tool.** A wrong pick is fixed by deleting the appointment, and a
  duplicate patient by deleting the patient while it has no completed OPD.
