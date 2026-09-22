# Digital OPD — Design Handoff

**For:** Enakshi (UI design) · **From:** Anjit · **Date:** 2026-09-03
**Purpose:** everything needed to design/redesign screens without reading the codebase.

This replaces "the chat history". The build conversations are ~59 MB of tool calls,
file diffs and debugging — not readable, and not a spec. What follows is the actual
state of the product: every screen that exists today, what is on it, and the design
tokens already in the code.

---

## 1. What the product is

A multi-tenant OPD (outpatient) appointment + consultation platform for clinics.
A patient books a slot with a doctor, the doctor runs the consultation, issues a
prescription, and reports/AI summaries stay attached to the visit history.

**Four front-end surfaces, all live and built:**

| # | Surface | Folder | Tech | Who uses it |
|---|---|---|---|---|
| 1 | **Patient web** | `patient-web-OPD` | React + Vite | Patients — booking + their history |
| 2 | **Patient mobile app** | `patient-OPD` | Flutter (iOS/Android) | Same as above, native |
| 3 | **Admin / Doctor web** | `admin-OPD` | React + Vite | Doctors, clinic staff, platform super-admin |
| 4 | **Admin / Doctor mobile app** | `admin-app-OPD` | Flutter (tablet-first) | Doctors — consultation + handwriting on a tablet |

Surfaces 1 & 2 are the same product in two shells; so are 3 & 4. Designs should be
drawn **per pair** (one responsive web layout + one native layout), not four times over.

---

## 2. Design system already in code — "Calm Clinical"

Please design **to these tokens**. They are implemented in
`admin-OPD/src/index.css` and in the Flutter `ThemeData`. Changing them is fine, but
tell us — it is a token change on both platforms, not a per-screen change.

### Palette

| Token | Hex | Use |
|---|---|---|
| Primary (trust blue) | `#185FA5` | primary buttons, active nav, links, doctor branding |
| Primary hover | `#0C447C` | hover / pressed |
| Primary tint | `#E6F1FB` | selected rows, info surfaces |
| Secondary (healing teal) | `#0F6E56` | success, confirmed, selected slot, "paid" |
| Secondary accent | `#1D9E75` | teal accent |
| Secondary tint | `#E1F5EE` | success surface backgrounds |
| Page background | `#F7F8FA` | app background |
| Card | `#FFFFFF` | surfaces |
| Hairline border | `#E4E7EC` | 0.5px borders, dividers |
| Text primary | `#1A2433` | body, headings |
| Text secondary | `#5F6B7A` | captions, meta |

### Semantic colours — reserved, never decorative

These map 1:1 to record state. A colour on screen tells you the record's status.
**Do not reuse them as accents.**

| State | Colour | Where |
|---|---|---|
| available | blue `#185FA5` | selectable slot |
| booked | grey `#D3D1C7` | occupied slot (not selectable) |
| on_hold | amber `#BA7517` | consultation on hold |
| rejected / error | red `#E24B4A` | rejected booking or payment, error states |
| done / confirmed / paid | teal `#0F6E56` | completed consultation, confirmed booking, verified payment |

### Type & feel

- **Inter** (fallback DM Sans), Google Fonts. **Two weights only:** 400 body, 500 headings.
- **Sentence case everywhere. No ALL CAPS.**
- Flat surfaces — **no gradients, no heavy shadows**.
- 0.5px hairline borders. **Card radius 12px, control radius 8px.**
- Generous whitespace; the slot grid is dense, so small-size legibility matters most.

---

## 3. Screen inventory

### 3.1 Patient web (`patient-web-OPD`) — 11 screens

| Route | Screen | What's on it |
|---|---|---|
| `/` | **Home** | Landing. Short; most traffic arrives on a doctor link instead. |
| `/d/:slug` | **Doctor landing** | The main entry point. Doctor photo, name, specialization, qualifications, bio; "OPD Appointment" panel with a **date strip ("Pick a date")** and a **slot grid** (available / booked / past). This is the highest-value screen to design well. |
| `/book` | **Booking form — 4 steps** | Step 1 Mobile number → password / create password. Step 2 "Who is this visit for?" (pick an existing patient card or add new). Step 3 Patient details (name, age, gender, address, city, state, PIN). Step 4 Reports (optional upload). Header shows `Step n of 4 · <title>` + "Complete Your Booking". Back button skips step 2 when the number is new. |
| `/confirmation` | **Confirmation** | Booking reference, doctor, patient, date/time. |
| `/login` | **Patient login / register** | Mobile → password, or create an account (name, gender, age, address, city, state, PIN). |
| `/visits` | **My visits** | Visit list with status chips (Cancelled / Rejected / done), prescription link, "Upload report", inline edit, "Cancel this appointment". |
| `/reports` | **My reports** | Uploaded lab reports for the account. |
| `/notifications` | **Notifications** | List + unread badge, mark-as-read. |
| `/patients` | **Patients (family profiles)** | Cards for every person on this mobile number. Add a patient (name, gender, age, relation: Self / Spouse / Child / Parent / Other, address). Delete. **No merge** — see §4.3. |
| `/privacy` | **Privacy policy** | Static, 6 sections. Low design priority. |
| — | **Header / AccountNav** | Login pill, "Appointment", "Visits", "Reports", bell with unread count, avatar + logout. |

Shared components worth a design spec: `PatientSwitcher`, `ConfirmDialog`, `StateView`
(loading / empty / error), `Footer`, `PasswordField`, `NetworkAvatar`.

### 3.2 Patient mobile app (`patient-OPD`) — Flutter

Same product, bottom tab bar: **Book · Visits · Reports · Alerts** (Alerts carries the
unread badge). Logged-out tabs show a prompt ("Login to see your consultation history.").

| Screen | Notes |
|---|---|
| **Home / Book** | Doctor info, "Pick a date" strip, "Available slots" grid, Booked / past states, empty state "No slots for this day." |
| **Booking form** | Existing-patient picker → details → "Confirm booking". Inline validation. |
| **Confirmation** | "Booking confirmed" + reference, doctor, patient, date, time, "Back to doctors". |
| **Login / Register** | "Login to your account" / "Create your account". |
| **My visits** | "Patients on this number" switcher, prescriptions, cancel flow with confirm sheet ("Cancel this appointment?" → Cancel / Keep it). |
| **Patients** | Add / delete patient, relation chips, "No visits yet" empty state. |
| **Reports** | "My Reports". |
| **Notifications** | "Mark all read", empty state "No notifications yet." |

### 3.3 Admin / Doctor web (`admin-OPD`) — 14 screens

Sidebar is **permission-driven** — each user sees only the modules their role can read.
Design the sidebar for a *variable* item count, and design the collapsed/mobile drawer.

Sidebar items: Doctors 🏥, Settings ⚙️ (super-admin only) · Appointments 🗓, Blocked
Patients 🚫, Users 👤, Roles 🔑 (clinic side). Pathlabs 🧪 and Reports 📄 exist but are
currently hidden from the menu.

| Route | Screen | What's on it |
|---|---|---|
| `/login` | **Login** | "Digital OPD" wordmark, email + password. |
| `/register` | **Doctor self-registration** | "Register your practice" — name, email, password, mobile, registration no., specialization, qualifications. Success state: "Your practice is ready ✓". |
| `/dashboard` | **Appointments (main workspace)** | Search by patient name / mobile, date filter, status filter, list of the day's appointments. The screen a doctor lives on. |
| `/appointments/:id` | **Appointment detail** ⭐ | The most complex screen. Sections: **Patient details**, **Previous visits**, **Doctor's note**, **Prescription** (3 modes, §4.2), **Next-visit reminder** with suggested date, **Reschedule slot**, reports and **Combined AI summary**. |
| `/doctors` | **Doctors** | List + create/edit doctor profile, photo, payment QR, enable/disable. Super-admin. |
| `/profile` | **My profile / My account** | Doctor's own details, password change, and **Prescription letterhead** (clinic name, logo, address, phone) — this feeds the printed A4 PDF. |
| `/profile/schedule` | **My schedule** | Weekday timings with **split sessions** (e.g. 11:00–14:00 *and* 17:00–19:00 on one day), per-session slot duration, live slot preview, leave days. |
| `/users` | **Users** | Clinic staff accounts. |
| `/roles` | **Roles & permissions** | Permission matrix — module × action (create/read/update/delete). |
| `/blocked-numbers` | **Blocked patients** | Mobile number + reason (e.g. "repeated no-shows"). |
| `/settings` | **Settings** | Tenant settings, booking URL. Super-admin. |
| `/pathlabs` | **Pathlabs** | Built, hidden from menu. |
| `/reports` | **Reports** | Built, hidden from menu. |

Components with real design weight: `AppointmentDetail`, `PrescriptionTabs`,
`PrescriptionEditor`, `PrescriptionPreview`, `HandwritingCanvas`, `ConsultationRecorder`,
`CombinedSummaryDetail`, `ProgressSummaryCard`, `ReportUpload`, `CameraCapture`,
`WalkInModal`, `InlineSlotPicker`, `Toast` (top-right).

### 3.4 Admin / Doctor mobile app (`admin-app-OPD`) — Flutter, tablet-first

| Screen | Notes |
|---|---|
| **Dashboard / Appointments** | Today / Upcoming / Previous / Pending tabs, "Pick a date", **Walk-in** FAB, refresh, empty state. |
| **Appointment detail** | Filters (All doctors / Any date / Any status), reschedule ("Confirm new slot"), "Close this consultation", **AI summary report** and **Combined AI summary**, "Add reminder". |
| **Consultation panel** ⭐ | The core doctor tool. Diagnosis, medicine rows (name, frequency, duration in days), Advice, **AI Suggested** chips, draft autosave ("Draft saved"), **Issue prescription** → Issued, share. |
| **Handwriting pad** ⭐ | Stylus capture on tablet, exported as strokes and composited onto the letterhead. Needs a real design: pen/eraser, clear, undo, page area matching A4 portrait. |
| **Walk-in form** | Full registration at the desk — patient details + slot. "Payment is collected in person at the clinic." |
| **Doctors / Users / Roles / Pathlabs / Reports / Profile / Schedule / Login** | Mobile equivalents of the web screens. Nav is a drawer with the same permission filtering. |

---

## 4. Flows that need design thinking (not just screens)

### 4.1 Booking + slots
Booking window is **today → +7 days**. Slots are **derived** from the doctor's
session blocks, never a fixed count — the grid length changes per day. A weekday can
have **two or more sessions**, so the grid needs session headers. Past-time slots are
shown but disabled. Payment is QR + screenshot upload; a rejected screenshot releases
the slot back to available.

### 4.2 Prescription — three modes (the product's differentiator)
One appointment, three ways to produce the same prescription, all ending at
**Issue → branded A4 PDF → patient notified**:

1. **✍️ Handwrite** — stylus on the tablet; strokes are composited onto the doctor's
   letterhead. No OCR, the image *is* the prescription.
2. **🎙️ Voice** — dictate → AI draft → doctor reviews and edits.
3. **⌨️ Type** — structured rows (medicine, frequency, duration, advice).

Design need: one tab control that makes all three feel like one tool, plus the A4
letterhead layout (per-doctor clinic name, logo, address, phone).

### 4.3 Family profiles — one mobile number, many patients
A phone number is an **account**; the people on it are patient profiles.
Three rules the client locked, which the UI must express:

- **Never match a patient by name** — two people on one number can share a name.
  Selection at booking is always an explicit card pick.
- **No merge tool.** A wrong pick is fixed by cancelling the appointment or deleting
  the patient — and only before a consultation is done.
- **A walk-in is a full registration**, so that patient can log in later with the number.

### 4.4 AI summaries
Each visit gets a summary; when a visit has several reports there is a **Combined AI
summary** (always called exactly that in the UI — never "Combined summary"). A
**progress summary** carries the trajectory forward from the previous visit. Needs a
card design that reads at a glance during a consultation.

---

## 5. What we'd like back, in priority order

1. **Doctor landing + slot grid** (patient web) — highest traffic, sets the tone.
2. **Booking form, 4 steps** (patient web + app) — including the family-patient picker.
3. **Appointment detail / consultation panel** (admin web + tablet) — the doctor's workspace.
4. **Prescription: 3-mode tabs + handwriting pad + A4 letterhead output.**
5. **Dashboard / appointments list** (admin web + app).
6. My visits, Patients, Reports, Notifications (patient side).
7. Users, Roles matrix, Schedule editor, Profile (admin side).
8. Login / register screens across all four surfaces.
9. Shared states: loading, empty, error, toast, confirm dialog.

**Per screen we need:** desktop (1440) + mobile (375) for web, tablet (1024) for the
doctor app; all interactive states (default / hover / active / disabled / error); and
the empty + error variants for anything that loads data.

**Format:** Figma, one page per surface, components as components, colours as styles
mapped to the token names in §2 so we can wire them straight into CSS variables and
Flutter theme constants.

---

## 6. Constraints worth knowing before drawing

- **Multi-tenant** — clinic name, logo, doctor photo and payment QR are all per-doctor
  data. Nothing may be hard-coded branding.
- **Permission-driven navigation** — sidebar/drawer item count varies by role. No
  design that assumes a fixed 6 items.
- **Mobile-first responsive** on the admin web too; front-desk staff use phones.
- **No patient cancellation was the original policy**; cancellation now exists on the
  patient side (visits list). Confirm current behaviour before designing that flow.
- **Semantic colours are reserved** (§2) — this is the one rule we cannot bend.

---

*Source docs in the repo, if more depth is needed:*
`opd-appointment-system-plan.md` (full technical plan, §15 = design system) ·
`PRESCRIPTION-PLAN.md` · `FAMILY-PROFILES-PLAN.md` · `MULTI-TENANT-PLAN.md` · `TASKS.md`
