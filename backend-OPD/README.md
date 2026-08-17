# OPD Backend API

NestJS + Sequelize + PostgreSQL API for the OPD Appointment Booking System.
See the [technical plan](../opd-appointment-system-plan.md) and [task board](../TASKS.md).

## Stack
- **NestJS 10** (REST), **Sequelize 6** (+ sequelize-typescript), **PostgreSQL**
- **JWT** auth, **config-driven RBAC** (roles × module/action permissions)
- **AWS S3** storage (payment screenshots, QR, photos)
- **Swagger** docs, **pino** logging, **class-validator** DTOs
- Uniform response envelope + stable domain error codes

## Prerequisites
- Node ≥ 20, PostgreSQL ≥ 14, an S3 bucket + credentials

## Setup

```bash
npm install
cp .env.example .env      # fill in DB + AWS + JWT values
npm run db:migrate        # create schema
npm run db:seed           # seed permissions + SuperAdmin
npm run start:dev
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/api/health`

Default SuperAdmin comes from `.env` (`SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`).

## Docker

```bash
docker compose up --build
```

Brings up Postgres + the API; the API container runs migrations + seed on boot.

## Scripts
| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch-mode dev server |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit tests (slot engine, time utils) |
| `npm run db:migrate` / `db:migrate:undo` | Run / revert migrations |
| `npm run db:seed` / `db:seed:undo` | Seed / unseed |

## Response contract

Success:
```json
{ "success": true, "statusCode": 200, "data": { }, "timestamp": "…" }
```

Error (always a readable `message`, stable `error` code):
```json
{ "success": false, "statusCode": 409, "error": "SLOT_ALREADY_BOOKED",
  "message": "This slot was just taken. Please pick another time.",
  "path": "/api/public/appointments", "timestamp": "…" }
```

Clients branch on `error`; show `message` to users. Full code list: `src/common/errors/error-codes.ts`.

## Layout
```
src/
  auth/           JWT login, strategy, /me
  users/          admin + doctor logins (CRUD)
  roles/          roles + permissions (RBAC)
  doctors/        doctor profiles, enable/disable, QR/photo, self-service
  opd-schedules/  weekly config (split sessions) + leave
  slots/          slot engine (derived, timezone-aware)
  appointments/   booking (public) + management (web) + dashboard feed
  dashboard/      today's counts
  uploads/        S3 StorageService
  common/         errors, guards, decorators, interceptors, enums, utils
  database/       models + Sequelize wiring
database/         migrations + seeders (sequelize-cli)
```
