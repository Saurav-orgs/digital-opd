# OPD Admin (web)

React + Vite + TypeScript admin/doctor portal for the OPD Appointment Booking System.
See the [technical plan](../opd-appointment-system-plan.md) and [task board](../TASKS.md).

## Stack
- **React 18 + Vite 5 + TypeScript**
- **TanStack Query** (server state) + **axios** (envelope unwrap + error normalization)
- **react-router-dom** routing with an auth guard
- **Calm Clinical** design system (plan §15) — CSS tokens, Inter, flat surfaces, semantic state colours

## Setup

```bash
npm install
cp .env.example .env      # VITE_API_BASE_URL (defaults to /api, proxied to :3000 in dev)
npm run dev               # http://localhost:5173
```

The backend (`../backend-OPD`) must be running on `:3000`. In dev, Vite proxies `/api` → `http://localhost:3000`.

Sign in with the seeded SuperAdmin (`superadmin@opd.local` / value from the backend `.env`).

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (HMR) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build |

## Screens
- **Login** — JWT, readable error messages from the API contract.
- **Dashboard** — today's appointment counts + schedule.
- **Doctors** — CRUD, enable/disable, payment-QR upload, link to schedule.
- **Doctor schedule** — weekly hours with **multiple sessions per day (split OPD)**, slot-duration, live slot preview, mark/remove leave (surfaces blocking bookings).
- **Appointments** — filter by doctor/date/status; detail with payment screenshot; verify/reject payment, mark consultation done/on_hold/rejected.
- **Users** — create admin/doctor logins, assign role, activate/deactivate.
- **Roles** — permission matrix (module × action); drives each user's sidebar.
- **My profile** — doctor self-service (permission-gated).

## How permissions drive the UI
`useAuth().can(module, action)` gates both the sidebar (`lib/nav.ts`) and per-row action buttons.
SuperAdmin sees everything; other users see only what their role's `read` grants, with create/update/delete
buttons shown per the matching action. The server enforces the same grants — the UI just mirrors them.

## Error handling
`api/client.ts` unwraps the backend's `{ success, data }` envelope and turns error envelopes into a typed
`ApiError { code, message, statusCode, details }`. Components show `message` (always user-safe) via toasts and
branch on `code` where needed (e.g. `LEAVE_HAS_BOOKINGS` surfaces the blocking bookings).
