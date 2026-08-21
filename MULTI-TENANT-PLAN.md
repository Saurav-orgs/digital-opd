# Multi-tenant OPD — implementation plan

## Decisions (locked)
- **Super admin = platform owner only.** No doctor profile, no clinical data. Creates & manages doctors.
- **Patient data siloed per doctor.** A patient entering via Doctor A's QR sees only Doctor A's visits/reports/prescriptions.
- **Per-tenant roles.** Each doctor gets their own roles; system roles stay global.
- **All surfaces**, including both Flutter apps.

## The tenant rule
Every clinical row belongs to one doctor (the tenant). Every authenticated caller is either:
- a **doctor** (`type=doctor`, has `doctorId`) — the tenant admin, or
- **staff** (`type=admin`/`pathlab`, has the doctor's `doctorId`) — same tenant, or
- the **platform super admin** (`doctorId=null`) — may only touch doctor-management routes.

Scope filter becomes: `where.doctor_id = user.doctorId` for every clinical query; reject when `doctorId` is null.

---

## Phase 1 — Schema & migrations
Migration `20260819-multi-tenant.js`:
- `roles`: add `doctor_id` UUID nullable (null = global/system role).
- `medicine_catalog`: add `doctor_id`; replace `unique(name)` → `unique(doctor_id, name)`.
- `patient_reports`: add `doctor_id` (denormalised so pathlab/standalone reports silo too).
- `notifications`: add `doctor_id`.
- `ai_training_samples`: add `doctor_id`.
- **Backfill**: set `doctor_id` on all existing rows to the current single doctor.
- `patients` stays a global identity (unique mobile) — siloing is enforced on the data views, not the login row.

## Phase 2 — Bootstrap + doctor-creation API
- **MasterSetup**: stop seeding a doctor; super admin keeps `doctor_id=null`. Keep the permission catalog + global `SuperAdmin` role. Add a `doctors:create`/`doctors:delete` capability that only the platform SuperAdmin holds.
- **`POST /doctors`** (super-admin only) creates, in one transaction:
  1. `Doctor` profile (name, specialization, fee…, unique `public_slug`).
  2. That tenant's default **roles** (copied templates): `Doctor` (all clinical modules), `Pathlab` (reports only), plus optional `Receptionist`/`Nurse`.
  3. The doctor **login** `User(type=doctor, doctor_id=new, role=tenant Doctor)` from an email + temp password in the DTO.
  4. Returns the doctor, the one-time login credentials, and the QR URL (`<patient-web>/d/<slug>`).
- Enable/disable + slug regeneration (rotate QR) endpoints.

## Phase 3 — Tenant scoping refactor (backend)
- Add `tenantId(user)` helper (returns `user.doctorId`, throws `FORBIDDEN` if null).
- Rework scoping from `type === DOCTOR` → tenant-based in: **appointments** (list/history/assertOwnership), **dashboard**, **reports** (`listForMobile` → filter by doctor), **opd-schedules**, **consultations**, **prescriptions**, **medicines** (catalog per tenant), **users** (`create` → creator's tenant; `findAll` scoped), **roles** (tenant + globals; `create` → tenant).
- `doctors` controller: split super-admin admin routes (list all / create / delete / enable) from the tenant `/doctors/me` self-service.

## Phase 4 — Patient siloing
- Patient JWT payload gains `doctorId`. `POST /patient/auth/login` + `register` take the doctor (slug or id) so the token is doctor-scoped.
- All `/patient/*` endpoints filter by `(mobile, doctorId)`.
- Reports & notifications created for a patient stamp the `doctor_id`.

## Phase 5 — Admin web (`admin-OPD`)
- **Super admin**: new **Doctors** page — list, **+ Create doctor** (shows credentials once + downloadable QR rendered from the slug URL), enable/disable, regenerate QR. Nav gated by `doctors:create`.
- **Doctor**: existing dashboard/appointments/schedule/profile — already scoped, now correctly isolated. Add a **"My QR"** panel in Profile.

## Phase 6 — Patient web (`patient-web-OPD`)
- New landing route `/d/:slug` → loads that doctor, runs the existing booking flow for them (replaces `doctors[0]`).
- Carry the doctor context through booking → login → portal; **My Visits / Reports / Notifications** siloed to that doctor.
- A bare visit with no doctor context shows a "scan your doctor's QR" prompt (no global doctor list).

## Phase 7 — Flutter apps
- **admin-app-OPD**: super-admin doctor management (create + QR display/share); doctor flow unchanged but isolated.
- **patient-OPD**: QR/deep-link scan sets the doctor context; booking + portal siloed.

## Phase 8 — Verification
- Fresh DB: super admin boots with no doctor; create two doctors A & B.
- Book under each; confirm A's login never sees B's appointments/dashboard/reports/patients, and staff added by A are invisible to B.
- Patient scans A's QR → books → sees only A in My Visits; scanning B's QR is a separate silo.
- `npx tsc --noEmit` + build both web apps; `flutter analyze` both apps.
