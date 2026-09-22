# Client updates — September 2026

**Status: implemented (2026-09-15), verified in the browser against a local
backend; not yet committed or deployed.** Sixteen items from the client, all on
the admin web (`admin-OPD`) with small backend (`backend-OPD`) changes where
the UI cannot do it alone. The open questions below were built on the stated
assumptions — change the assumption, and the item is a small edit. Nothing here touches the patient app/web or the AI
service. The Flutter admin app (`admin-app-OPD`) is out of scope unless asked.

Legend: **(W)** admin web · **(B)** backend · **S/M/L** effort.

---

## Open questions (assumptions made below — correct them before build)

| # | Item | Assumption taken | Alternative reading |
|---|------|------------------|---------------------|
| 3 | "Patient summary with date range" | A From/To filter over the visits on the patient record (`/patients/:id` and the in-visit history page), with a "N visits · first – last" line. | Let the doctor pick a date range and rebuild the AI *progress summary* over only those visits — needs AI-service work; much bigger. |
| 9 | "Role-defined person can't add patients" | A restriction: staff accounts (non-doctor logins with a role) do **not** get the **Walk In** button, so only the doctor registers/books patients. | (a) Staff may book walk-ins for *existing* patients but not the "+ Add a new patient" path; or (b) it is a bug report — staff *should* be able to and can't because their role lacks `appointments:create/read`. Item 10 fixes (b) as a side effect. |
| 15 | "Walk-in report uploaded in the last box → hyperlink / view" | The last box on **Upload reports** (`/reports`) — the "Reports for {patient}" list — gets an explicit **View** button next to the title link, and the same in the patient-record history cards. | If it means a screen I have not found, need a screenshot. The consultation page's report rows already have View/Print/Download. |
| 10 | "Except last two permissions" | Last two **rows** of the role matrix = **My Team** and **Roles**. Everything else (Appointments, Patients, Upload reports — all four actions) pre-ticked on *Add role*. | "Last two" could mean the `update`/`delete` columns. Unlikely — they'd have said columns. |

---

## A. Schedule & profile

### 1. Vacation shows only start and end date — **(W) M, (B) S**
Leave is stored one row per date (`schedule_exceptions`); registration expands a
From–To range into N rows, and **My schedule → Leave days** then lists every
date separately.

- **(B)** `POST /doctors/:id/schedules/leave`: `MarkLeaveDto` gains optional
  `end_date`; service upserts every date in the range in one transaction and
  runs the confirmed-bookings check across the whole range (reuse `expandDates`
  from `doctors.service.ts`). `DELETE …/leave/:date` gains optional `?to=`.
- **(W)** `DoctorSchedule.tsx → LeavePanel`: From/To inputs instead of one
  date (same shape as registration's vacation rows). The list groups
  consecutive dates with the same reason into one row: **12 Oct – 18 Oct 2026 ·
  Family vacation**, single date shows as one date. Remove deletes the whole
  range.
- Files: `opd-schedules/dto/schedule.dto.ts`, `opd-schedules.service.ts`,
  `admin-OPD/src/pages/DoctorSchedule.tsx`, `api/endpoints.ts`.

### 2. Morning / evening sessions on two lines — **(W) S**
`DayAvailabilityEditor.tsx` summary line joins sessions with `", "`. Render
each session as its own line (`dr-summary` becomes a stacked list, one
`<span>` per session). Applies to both registration and My schedule since the
editor is shared.

### 5. Default slot 10:00–14:00 — **(W) S**
`DayAvailabilityEditor.tsx → blankDay()` currently `09:00–13:00` → `10:00–14:00`.
Leave the "add another slot" default (`17:00–19:00`) as is.

### 6. Letterhead in the burger menu + during registration (skippable) — **(W) M, (B) S**
- **(W)** Move the "Prescription letterhead" section (header image upload,
  address, phone, live preview + `checkHeaderImage`, `LetterheadPreview`) out of
  `Profile.tsx` into a new page `pages/Letterhead.tsx` at `/profile/letterhead`.
  Add a `letterhead` NAV item (`doctorOnly`, icon `document`, module
  `doctors`… see note) so it appears in the sidebar/burger drawer. Profile keeps
  a "Letterhead" button next to "Schedule".
  - Note: the sidebar filters by `can(module,'read')`; the profile/letterhead
    pages are doctor-scoped, not permission-scoped. Add an `isDoctor`-only
    branch in `Layout.tsx` like the existing "My profile" link rather than
    inventing a permission.
- **(W)** Registration stage 3 gets a **Letterhead (optional)** box: upload
  the header strip with the same ratio/size check, preview, and a clear
  "Skip — I'll add it later" affordance (it's simply optional; the CTA does not
  depend on it).
- **(B)** `POST /doctors/register` accepts a third multipart file
  `letterhead_header` (`FileFieldsInterceptor`), validated as in
  `uploadLetterheadHeader` (png/jpeg), stored under
  `doctors/{id}/letterhead-header`, key saved on the doctor. Upload happens
  after the transaction like the photo.

---

## B. Auth, header, team & roles

### 4. Register → straight to dashboard — **(B) S, (W) S**
- **(B)** `DoctorsController.register` returns `{ accessToken, user }` (sign
  the JWT via `AuthService`/`JwtService` for the new user, `UsersService.toAuthUser`).
  Log a `LOGIN` activity the same way `login()` does.
- **(W)** `AuthContext` gains `setSession({ accessToken, user })`.
  `DoctorRegister.tsx` on success: store token, set user, `navigate('/', {replace:true})`
  → `Home` sends the doctor to `/dashboard`. Drop the "Your practice is ready →
  Sign in" screen (or keep it as a 1-line toast on the dashboard).

### 8. Header: user name · role, doctor's name below — **(B) S, (W) S**
- **(B)** `AuthUser` gains `roleName: string | null` (from `user.role?.name`) in
  `UsersService.toAuthUser`. Returned by login, `/auth/me` and register.
- **(W)** `Dashboard.tsx → DoctorHero` and the mobile `TopbarPortal`: when the
  logged-in user is **not** the doctor (`!isDoctor`), line 1 = `{user.name}`
  with a role chip `{roleName}` in front; line 2 = `Dr. {doctor.name}` (from
  `doctorsApi.me`, which already loads for any account with a `doctorId`).
  Doctor login is unchanged.

### 7. Remove "Type" column from users table — **(W) S**
`Users.tsx`: drop the `<th>Type</th>` / `<td>` pair. Keep the `type` checks
that hide edit/delete on the super-admin row.

### 16. "Users" → "My Team" — **(W) S**
`lib/nav.ts` label + `MODULE_LABEL.users`, `Users.tsx` heading, "Add user" →
"Add team member", modal titles, toasts, empty state. Route `/users` and the
`users` permission module stay as they are (renaming those buys nothing and
breaks saved links).

### 10. New role: everything pre-ticked except the last two — **(W) S**
`Roles.tsx → RoleModal`: give the matrix a fixed row order via a
`ROLE_MODULE_ORDER` in `lib/nav.ts` — Appointments, Patients, Upload reports,
My Team, Roles. On **Add role** (not Edit), initialise `selected` with every
permission id of every module except the last two. Editing an existing role
still opens with what it holds.

### 9. Role-defined (staff) login cannot add patients — **(W) S** (+ optional (B) S)
`Dashboard.tsx`: render the **Walk In** FAB only when `isDoctor` (currently
`can('appointments','create')`). Same guard on the walk-in modal mount.
Optional **(B)**: reject `POST /appointments/walk-in` for `type !== doctor/super_admin`
so the rule holds for the API as well, not only the button.
*See the open question — if this was a bug report instead, the fix is item 10
plus checking the role holds `appointments:create` + `appointments:read`.*

---

## C. Patients & appointments

### 3. Patient summary with date range — **(W) S–M**
`PatientDetail.tsx` and `PatientHistoryPage.tsx`: a From/To pair above the
visits list, filtered client-side (the history endpoint already returns every
visit for the profile). Summary line: **"7 visits · 3 Jan 2026 – 12 Sep 2026"**
that updates with the filter. No backend change.

### 11. "Previous" tab: date-range filter — **(B) S, (W) M**
- **(B)** `ListAppointmentsQueryDto` gains `from` / `to` (YYYY-MM-DD). Service:
  if either is set, `appointment_date` becomes a `BETWEEN`/`>=`/`<=` and it
  takes precedence over `range`, same as `date` does today.
- **(W)** `Dashboard.tsx`: the existing "Date" filter dropdown gets a second
  mode — on the **Previous** tab it shows From / To (plus "Any date"); Today /
  Upcoming keep the single date picker. Pass `from`/`to` through
  `appointmentsApi.list` and the query key; the filter chip label reads
  "3 Jan – 12 Sep".

### 13. "Mark as no-show" in black — **(W) S**
`AppointmentPage.tsx` options menu: drop the `danger` class from the no-show
item (keep it on "Block this patient" / cancel). `index.css` `.opts-item`
default colour is already the text colour; verify hover doesn't go red.

### 14. Reschedule confirmation popup — **(W) S**
`AppointmentPage.tsx → reschedule.onSuccess`: replace the generic toast with
**"Appointment for {patient} rescheduled from {old date, time} to {new date,
time}"**. Capture old date/time before the mutation. Rendered as a short
centred overlay that auto-dismisses after ~1.2 s (a small `FlashNotice`
component; the toast stack is top-right and 4.5 s, which is not what was
asked). Keep the toast API for everything else.

### 15. Walk-in report → view link — **(W) S**
`Reports.tsx` last card: each row gets a `View report` button (opens the
presigned `url` in a new tab) in addition to the title link, and a small file
icon so it reads as a document. `HistoryVisit.tsx` report links get the same
treatment. *See open question.*

### 17. Blocked patients: a real list — **(B) S, (W) M**
- **(B)** `BlockedNumbersService.list` joins the patient profiles registered
  on each number (via `patient_accounts` → `patient_profiles`) and returns
  `patients: [{ id, name, patient_code }]` plus `blocked_by` (user name) and
  `created_at` per row.
- **(W)** `BlockedNumbers.tsx`: replace the card stack with a table (cards on
  phone, like Patients): **Patient(s) · Mobile · Reason · Blocked on · Blocked by
  · Unblock**. Add a search box (name / number). Empty state unchanged.
  Name links to `/patients/:id` when the profile exists.

---

## D. Prescription preview

### 12. Preview fits one page, delete top-right, maximise — **(W) M**
- `PdfPages.tsx`: add a `fit: 'width' | 'page'` prop. In `page` mode the
  scale is `min(hostWidth / pageWidth, hostHeight / pageHeight)` so the first
  page is fully visible with no scrolling (`overflow: hidden`). Multi-page
  documents still stack, but page 1 is what fits.
- `PrescriptionPreview.tsx → PrescriptionPreviewPanel`:
  - `pdf-bar` gets a **trash icon button** on the right (before/after Edit),
    wired to the existing `confirmDelete` flow; remove the bottom
    "Delete prescription" button.
  - A **maximise** icon button in the same bar opens the document in a
    full-screen `Modal` (`large`, near-viewport height) rendered with
    `fit='width'` — that is where the doctor reads it closely.
  - The inline panel height drops from `58vh` to the page-fit height; on
    phones (`< 700px`) the same rule applies, so nothing scrolls inside the
    preview.
- `index.css`: `.pdf-scroll` → no inner scrolling in page-fit mode; new
  `.pdf-bar-icon` style for the two icon buttons.

---

## Build order

1. **Quick wins (½ day):** 2, 5, 7, 13, 16, 10, 9(W), 15 — all (W) only, no API.
2. **Auth/header (½ day):** 4, 8 — backend `roleName` + register token, then
   the two UI changes.
3. **Schedule (½–1 day):** 1 (range leave), 6 (letterhead page + registration).
4. **Lists (1 day):** 11 (previous date range), 17 (blocked table), 3
   (patient visits range).
5. **Preview (½ day):** 12, 14.

Backend changes are additive (new optional fields / extra response keys), so the
web can ship item by item without a coordinated deploy — except item 4, where
the register endpoint's response shape changes and the web must handle both
`{ok}` and `{accessToken}` until the API is out.

## Verification
- Each (W) item checked in the browser preview at desktop and 375px.
- Backend: `npm run test` for slots/leave; manual Swagger call for
  `leave` range + `from/to` list.
- Item 4 end-to-end: register a fresh doctor → lands on `/dashboard` with a
  valid `/auth/me`.
