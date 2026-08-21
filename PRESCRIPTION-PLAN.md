# Prescription System — Three-Mode Plan

The differentiator: give doctors **three ways** to produce the same issued
prescription, and make the output look **exactly like their own hospital pad**.

- ✍️ **Handwrite** (e-pen on tablet) — the "pen-paper" experience, primary on the Flutter admin app
- 🎙️ **Voice** — dictate; AI drafts; doctor reviews *(already built)*
- ⌨️ **Type** — structured medicine rows *(already built)*

All three end at the same **Issue** action → branded A4 PDF → patient notified.

## Decisions locked
- Handwriting surface: **Flutter tablet app first** (Apple Pencil / stylus), web later
- Handwriting output: **image composited onto the letterhead** (no OCR in v1)
- Paper size: **A4 portrait**
- Letterhead fields: **clinic/practice name, logo, address, phone** (doctor-only self-service)

---

## What already exists (reused, not rebuilt)
- `EPrescription` + `EPrescriptionMedicine` models (diagnosis, advice, follow-up, medicine rows)
- Voice pipeline: `consultations.service.ts` (record → transcribe → AI draft)
- Structured editors: web `PrescriptionEditor.tsx`, Flutter `consultation_panel.dart`
- Issue flow + branded A4 PDF: `prescriptions.service.ts`, `prescription-pdf.service.ts`
- **Gap:** letterhead is global env (`CLINIC_NAME`…), not per-doctor — wrong for multi-tenant

---

## Phase 1 — Per-doctor letterhead (foundation for all three modes) ✅ DONE

Implemented: migration `20260819000002-doctor-letterhead.js`; `clinic_name/
clinic_logo_key/clinic_address/clinic_phone` on the doctor model + DTO; self-
service `POST /doctors/me/letterhead-logo`; PDF letterhead reads the doctor
(logo embedded, env fallback); web + Flutter Profile settings with a live A4
preview. Backend + web typecheck clean; Flutter reviewed by hand (no SDK on PATH).

### Original scope

**Backend**
- Add columns to `doctors`: `clinic_name`, `clinic_logo_key`, `clinic_address`,
  `clinic_phone`, `clinic_email`, `registration_no`, `letterhead_footer`
  (all nullable; fall back to env `clinic` when unset)
- Migration in `master-setup` / sync
- Extend `doctors` self-service DTO + `updateMe` to accept these
- Logo upload endpoint (reuse `StorageService.uploadImage`, like profile photo)
- `prescription-pdf.service.ts`: read letterhead from the `doctor` row (not env)

**Web admin (`Profile.tsx`)**
- "Prescription letterhead" section: the fields above + logo upload
- Live A4 preview panel so the doctor sees their pad as they edit

**Flutter admin (`profile_screen.dart`)**
- Same fields + logo picker (`image_picker` already a dep)

**Acceptance:** a doctor sets their clinic name/logo/address → issued PDF shows it.

---

## Phase 2 — Tabbed prescription UI on the appointment detail ✅ DONE

Implemented: web `PrescriptionTabs.tsx` (Handwrite · Voice · Type) swapped into
`AppointmentDetail.tsx`; Flutter `consultation_panel.dart` refactored to the same
three-mode tabs. Voice + Type share the structured editor; Handwrite shows a
placeholder until Phase 3. Web typecheck clean; Flutter reviewed by hand.

### Original scope

**Web (`AppointmentDetail.tsx`)**
- Replace the stacked "Voice prescription" block with a segmented tab control:
  **Handwrite · Voice · Type**
- Voice tab = `ConsultationRecorder`; Type tab = `PrescriptionEditor` (both exist)
- Handwrite tab (web): placeholder pointing to the tablet app in v1 (web canvas is a later phase)
- One shared Issue action + issued-view across tabs

**Flutter (`consultation_panel.dart` → split into a tabbed panel)**
- `TabBar` with the three modes inside the appointment detail
- Voice + Type tabs = the existing recorder/editor, refactored into tab bodies

**Acceptance:** doctor switches modes with tabs; existing voice/type behavior intact.

---

## Phase 3 — Handwriting / e-pen canvas (Flutter, the new core) ✅ DONE (needs on-device test)

Implemented:
- Backend: migration `20260819000003-prescription-handwriting.js`; `mode` +
  `handwriting_image_key` on `EPrescription`; `PrescriptionMode` enum;
  `POST /appointments/:id/prescription/handwriting`; `saveHandwriting` service;
  issue/validation branch on mode; PDF composites the strokes onto the letterhead
  (`handwritingBody`). Backend typecheck clean.
- Flutter: `handwriting_pad.dart` (stylus capture with pressure width, pen/eraser/
  undo/clear, transparent-PNG export via `RepaintBoundary`); wired into the
  Handwrite tab with an Issue action; issued view shows the drawing. Reviewed by
  hand — **must be run on a real tablet with a stylus to verify drawing + export.**

### Original scope

**Model / backend**
- Add to `e_prescriptions`: `mode` enum (`structured` | `handwritten`),
  `handwriting_image_key` (S3 key of the transparent strokes PNG)
- New endpoint: `POST /appointments/:id/prescription/handwriting`
  (multipart image) → stores key, sets `mode=handwritten`, keeps status `draft`
- `prescription-pdf.service.ts`: when `mode=handwritten`, render
  **letterhead + patient bar → embed handwriting PNG in the body → signature + footer**
  (letterhead stays server-authoritative; handwriting is an overlay layer)

**Flutter handwriting widget (`handwriting_pad.dart`)**
- `Listener`/`CustomPainter` capturing `PointerEvent`s; use
  `PointerDeviceKind.stylus` + `pressure` for variable stroke width (pen feel)
- Canvas sized to the A4 **body** aspect ratio, with a faint header guide showing
  where the server letterhead will sit (so the writable area is honest)
- Tools: pen, eraser, undo/redo, clear; smoothing via quadratic-bezier point interpolation
- Export: `RenderRepaintBoundary.toImage()` → transparent high-res PNG → upload
- Wire into the Handwrite tab; Issue composites + notifies via the existing flow

**Acceptance:** doctor writes with the pencil, presses Issue, patient receives a
PDF that is their letterhead with the handwritten body — smooth, no lag.

---

## Phase 4 — Polish & later
- ✅ Web handwriting canvas (Pointer Events) to match Flutter —
  `components/HandwritingCanvas.tsx` (pen/eraser/undo/clear, pressure width,
  transparent-PNG export → same `saveHandwriting` endpoint), wired into the
  Handwrite tab of `PrescriptionTabs.tsx`; issued view shows the drawing + PDF.
  Web typechecks clean; app renders (verified login page after a Vite restart —
  the canvas itself sits behind login, which isn't reachable here).
- "Reuse last prescription" / templates (todo)
- Multi-page handwriting (add page) (todo)
- Reload a saved handwriting draft back onto the canvas (todo — pads open blank)
- Optional: opt-in OCR to also capture structured medicines from handwriting (todo)

---

## Open questions before build
- Letterhead field list above OK, or add/remove any? (e.g. two-doctor clinics, GST no.)
- Should super-admin also edit a doctor's letterhead, or doctor-only self-service?
