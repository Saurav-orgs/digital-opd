# Design alignment — client update, Sept 2026 (round 2)

Source: `~/Downloads/myDigitalOPD-app-standalone.html` (mobile) and
`myDigitalOPD-desktop-app.html` (desktop). Both are shells with three screens
base64-embedded inside them; decoded copies of the markup live in the session
scratchpad. The two bundles are the *same* design — the desktop file only adds
`@media (min-width: 1024px)` blocks (and, in the export, one extra "Issue to
Patient" button that we are shipping on mobile too).

Design tokens are byte-identical to `admin-OPD/src/index.css` — the 7 Sep token
swap stands. No palette work.

Scope: **`admin-OPD` (doctor web) only.** `patient-web-OPD` and the two Flutter
apps are untouched.

## Decisions (client, answered in full)

| # | Question | Answer |
|---|---|---|
| 1 | Which preview actions complete the visit | Share, Print **and** Issue all mark complete |
| 2 | Does Share/Print also issue the Rx to the patient | No — only "Issue prescription" issues |
| 3 | Locked once complete | No; doctor can edit and re-mark |
| 4 | Cancel lives only on the patient card | Yes |
| 5 | Issue button on mobile | Yes, add it |
| 6 | Walk-in: DOB instead of age | Yes |
| 7 | Walk-in: pick a slot | No — no date/time at all; a walk-in is routinely outside slot hours |
| 8 | Cap of 5 patients per mobile number | Yes, add it |
| 9 | Walk-in address fields | Drop from the UI, keep the columns in the DB |
| 10 | Registration login id | Email only (no mobile) |
| 11 | Slot duration | Keep the field, default 15 min |
| 12 | Clinic name / T&C | Drop clinic name; T&C moves to the last step |
| 13 | My Profile → Schedule | Same per-day design as registration |
| 14 | Patients module in the sidebar | Add it |
| 15 | Super-admin screens | Flow unchanged, theme colours only |
| 16 | 72px collapsible rail | Yes |
| 17 | Doctor's note / next-visit reminder | Remove both |
| 18 | Mark as no-show | Add it |
| 19 | AI summary | The box is the **combined** summary; a report's summary button opens that report's own summary |
| 20 | Step locking | Yes — "Save prescription" gates Preview; handle the no-prescription case |
| 21 | Apps in scope | `admin-OPD` only |
| 22 | Breakpoints | Adopt the design's 700 / 1024 |
| 23 | Delivery | One pass, complete |

Also confirmed: the report cards' own Print/Download do **not** complete a
visit, and registration stays public at `/register`, outside the Layout and out
of the sidebar.

## Work

### 1. Backend
- [x] `ConsultationStatus` += `no_show` (enum + migration + admin types).
- [x] Register DTO: availability becomes a per-day list of slots
      (`[{ day, slots: [{start_time, end_time}], slot_duration_min }]`).
      `opd_schedules` already permits several rows per weekday.
- [x] Enforce max 5 patient profiles per mobile number.
- [x] Walk-in: allow an appointment with no slot / outside published hours.
- [x] Block-patient action reachable from an appointment.

### 2. Shell (`Layout.tsx`, `index.css`)
- [x] Drawer < 700px, 72px icon rail ≥ 700px expanding to 240px via chevron.
- [x] Persist the collapsed/expanded choice.
- [x] Breakpoints move 900 → 700 / 1024.
- [x] Add the Patients nav item + a page behind it.

### 3. Dashboard
- [x] Drop the clinic line and date line from the hero.
- [x] Search box; status popover (All default) ; date popover (all three tabs);
      reset button.
- [x] Walk-In FAB replaces the toolbar button.
- [x] Card left accent per bucket; `N reports · Note added` strip that expands.
- [x] ≥1024: icon-left KPI tiles, single toolbar row, list as a table
      (Patient / Contact / Status / Time).

### 4. Walk-in modal
- [x] Rebuild as a 4-step wizard: phone → pick patient (cap 5) → new patient
      (name / gender / DOB / reason) → reason.
- [x] No date or time input.

### 5. Appointment detail
- [x] Remove the outcome card, the doctor's-note card and the reminder card.
- [x] Cancel + Reschedule as modals off the patient card.
- [x] ⋮ menu: Mark as no-show, Block patient.
- [x] Report cards: print / download / summary icon buttons; the summary button
      opens that report's summary. The top box is the combined summary.
- [x] "Add more reports": Upload / Take Photo tiles.
- [x] Step locking; Save prescription → Preview; empty-prescription case.
- [x] ≥1024: sticky patient panel left, working panel right.

### 6. Preview + completion
- [x] PDF viewer chrome (teal bar, filename, page count).
- [x] Issue to Patient (both breakpoints) + Share + Print.
- [x] All three set `consultation_status = done`; only Issue issues the Rx.
- [x] Success panel: Back to Appointments / Back to Preview.

### 7. Prescription tabs
- [x] 4-up icon grid, design order: Record · Type · Handwrite · Upload.

### 8. Registration + Profile schedule
- [x] Three steps: Account → Register → Availability.
- [x] Account: email + password + confirm, eye toggles.
- [x] Per-day accordion, several slots per day, Save day / Apply to all / Clear.
- [x] Slot duration field, default 15.
- [x] Drop clinic name; T&C on the last step.
- [x] Same accordion in My Profile → Schedule.
- [x] ≥1024: vertical stepper rail.

## Status

All of the above is built. Verified in the browser against the local backend as
`sweta@yopmail.com`: the collapsible rail (both states), the desktop
appointment table, a consultation end-to-end (step locking → save → preview →
**Issue**, which flipped the badge to Completed on its own), the ⋮ menu, the
walk-in wizard booking with no date or time, the Patients module, the mobile
drawer and cards, registration's three steps with the per-day accordion
(multi-slot, apply-to-all, overlap validation), and My Profile → Schedule
loading the doctor's existing split sessions into that same accordion.

Two things left in the dev database by that walkthrough: a walk-in for
"Test WalkIn Patient" on 9811072226, and an issued prescription on Sanjeev
Bhatia's 4 Sep visit.

### Open question

`contact_mobile` is still collected, on step 2 as the doctor's contact number
rather than on the account step as a login. Decision 10 was about the login
identifier, and the server DTO requires the field — dropping it altogether
would need a backend change. Confirm which was meant.

## Fix round 1 (client review)

| # | Reported | Fix |
|---|---|---|
| 1 | Write prescription / Back / Save not full width | Bottom-bar buttons are equal halves at every size; dropped the desktop `min-width` that was pinning the CTA |
| 2 | Patient history / Cancel / Reschedule too short | Fixed 34px height → `min-height` 40px (42px in the desktop patient column) with real padding, so two-line labels stop clipping |
| 3 | AI summary should open by default | It already defaulted open, but a stored fold from an earlier session kept it shut — storage keys bumped to `-v2`, so everyone starts open and the fold still works |
| 4 | Walk-in explainer text, small Check button, Cancel button | All three gone. The footer CTA does the lookup, and `Modal` gained a header × so the dialog is still dismissable |
| 5 | Header should be flush to top/left/right | `.doc-hero` is now a band at every breakpoint, each one cancelling whatever gutter `.content` carries (12/14 → 20 → 24/28); only the rounded underside is kept |
| 6 | "Walk-in pending" on appointment detail | All three header badges removed — the design's header is a back link and the ⋮ menu |
| 7 | No-show / Block should be red | Both carry `.opts-item.danger`; added the rule, which did not exist |
| 8 | Allow proceeding with no prescription | The empty draft now opens "Finish without a prescription?" instead of refusing. Confirming marks the visit complete and shows a closing panel with a way back into writing one |

Verified in the browser: bottom-bar halves measure 306/305 desktop and 167/166
mobile, action buttons 42px/40px, menu items `#c4433a`, header flush, walk-in
reduced to one field plus one button, and a real appointment closed with no
prescription and came back **Completed** on the dashboard.

## Fix round 2 (client review)

| # | Reported | Fix |
|---|---|---|
| 1 | Logo showing in the mobile top bar | Removed — the design's phone bar is the hamburger and nothing else. The wordmark is on the drawer that button opens |
| 2 | "Write prescription" covering the detail page | The bar is `position: fixed`, so the page now reserves 88px below itself for it (40px on desktop, where the bar unpins). Verified: content ends 33px clear of the bar at full scroll |
| 3 | Record and Type panels off-design | Both rebuilt — see below |

**Record panel** — a 64px berry mic centred in the card with a status line
under it ("Tap to start recording" / "Listening…" / "Transcribing…") and a
timer, under a "Record prescription · Dictate the diagnosis and medicines"
header. It was a small pill button in a toolbar row. The pulse animation on
record and the cancel-a-stuck-transcription escape hatch both survive.

**Type panel** — plain section headings (Diagnosis · Medicines · Advice)
instead of boxed labelled fields. Each medicine is a grey slab with
Medicine / Freq. / Duration on one line, a × disc in the corner, and its remark
folded behind "+ Add remark"; adding one is a dashed marigold bar. The
medicine-name warning and catalogue autocomplete are kept, moved below the row
where the design leaves room for them.

Also fixed while in there: on a phone the three medicine fields left the name
about 130px wide, so below 560px the name takes the row and Freq./Duration
share the next one.

## Fix round 3 (client review)

| # | Reported | Fix |
|---|---|---|
| 1 | Remove the follow-up date field | Off the form. A value already stored is still loaded and saved back untouched, so nothing existing is wiped — only new ones can no longer be set |
| 2 | Voice tab should show no fields until dictation fills them | The Record panel is now the microphone alone. The editor appears once a draft exists, and stays once it does, so correcting a dictated prescription never means switching tabs |
| 3 | Previous/Today/Upcoming touching the section above | `margin-top: 14px` on `.range-tabs` |
| 4 | A "Clear all" in Type, and the same in Voice | Added to `PrescriptionEditor`, which both modes render, so one button covers both. Behind a confirm; disabled while the form is already empty |

Notes on 2 and 4:

- "Is there a draft" is read from the **prescription**, not the recording
  session. The session is transient — gone on a reload — and the draft it
  produced is not, so a visit reopened tomorrow still shows the fields the
  recording filled.
- Clear all empties the form locally and marks it dirty; the server keeps the
  last saved version until Save draft is pressed. A mis-click is undone by
  leaving the step, not by a second destructive call.
