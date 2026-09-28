# Onboarding routes and doctor billing

Two ways a doctor account comes into being, one invoice trail behind both, and
a Billing screen where the doctor can see it.

Built 24 Sep 2026. Everything here is shipped unless a line says otherwise.

## The two ways in

Both end in the same place: a gated `users` row with no clinic behind it, which
sends the doctor to the first-login profile form (`/setup` → `POST
/doctors/me/setup`). One path through setup, not two.

**1. The doctor pays.** Unchanged from before: landing page → email code →
account with a password the doctor chooses → Cashfree → webhook or status poll
activates the subscription. What is new is what happens at activation — an
invoice is raised and emailed with the confirmation.

The doctor keeps choosing their own password, so the mail carries the login
link and the address to sign in with, not a password. A password we hashed
cannot be read back, and generating a second one for the mail would only
invalidate the one they had just typed.

**2. The super admin opens the account.** `POST /doctors/invite` — a name, an
email, and normally a plan. The server makes a temporary password, maps the
plan as a grant, and emails all three. The Doctors screen also shows the
password once, because mail is the part of this that can fail quietly.

That password has to be replaced before the account can be used — see
**Temporary passwords** below.

The old `POST /doctors` (full profile, admin types the password) stays for the
cases where the admin wants to fill everything in themselves.

## Who is refused at the login screen

`SubscriptionAccessService.assertAccess` gates **every doctor account** and
every staff login inside a doctor's tenant. Only the platform super admin, and
an account attached to no tenant at all, pass untouched.

Fixed 25 Sep 2026: it used to gate on `users.subscription_required`, a flag set
only by the paid sign-up and by a grant. A doctor created from **Doctors →
Create full profile**, or one who registered before plans existed, therefore
signed in with no plan at all — and, because the same flag guarded the
checkout, could not buy one either ("This account does not use online plans.
Please contact the myDigitalOPD team." on the Billing screen). Licensing is a
property of being a doctor on this platform, not of the door the account came in
through, so it is now decided on the account's type and tenant. The flag stays
on `users` as provenance — it answers "did this account come through
checkout?" on a support call — and decides nothing.

The message says which situation the account is in, because "your plan ran out",
"your payment never completed" and "we never mapped you a plan" are not the same
news — but all four end in the same offer, a plan list on the sign-in screen:

| Situation | What they are told | Offered the checkout |
| --- | --- | --- |
| Held a plan before, none live now | "Your subscription has ended. Choose a plan below to reactivate your account." | yes |
| An order was opened and never paid | "Your subscription payment did not complete… Choose a plan below to finish activating it." | yes |
| We opened the account, no plan mapped | "No plan has been added to your account yet. Choose a plan below to activate it, or contact the myDigitalOPD team." | yes |
| No plan, no order, nobody invited them | "This account has no active plan. Choose a plan below to activate it." | yes |
| Staff of any of the above | "This clinic's subscription is not active… ask the doctor to choose a plan." | no |

The third is why `users.invited_by` exists: without it, an abandoned checkout
and an account waiting on a plan look identical, and the doctor gets told to
finish a payment that was never meant for them. `POST /doctors` (the
full-profile form) now records it too, so an account an admin built by hand gets
that message — and the credentials dialog says up front that sign-in stays
blocked until a plan is mapped. It still offers the checkout: an invited doctor
who would rather pay than wait for us is not made to wait for us.

The fourth is the one the old flag hid — a doctor from before plans, with no
order and nobody who invited them.

"Held a plan before" is tested on `paid_at`, which is set both when money
arrives and when a plan is granted, and never on an order that was only opened.
"An order was opened" is any `subscriptions` row at all.

**The refusal is carried to the sign-in screen, not just to a toast.** Because
the JWT strategy refuses every authenticated route the moment a plan lapses, the
admin app treats `SUBSCRIPTION_REQUIRED` on any request as the end of the
session: the token is dropped, the app reloads onto `/login`, and the reason
travels in session storage so the doctor is not left looking at an unexplained
login form.

## Activating an account from the sign-in screen

A refused doctor is not sent anywhere to fix it. The refusal carries
`details.canSubscribe`, and the sign-in screen turns that into the plan list and
a checkout for that same account — the screen already knows which account is
stuck, and the doctor has just proved they own it by typing its password.

```
sign in → 402 SUBSCRIPTION_REQUIRED (canSubscribe)
        → plans (GET /signup/plans) shown in place of the form
        → POST /signup/resume { email, password, plan, origin: 'app' }
        → Cashfree → back to /login?order_id=…
        → poll GET /signup/orders/:id → "Payment received… sign in to continue"
```

- **No session is involved, and none can be** — this serves accounts that cannot
  sign in. The password is the authorisation, and `resume` re-checks it on every
  call. The credentials are frozen in component state at the moment of the
  refusal, so editing the form afterwards cannot point the checkout at a
  different account than the message is about; nothing is stored, and a reload
  asks again.
- **`origin` is a name, not a URL.** The route is public, so an arbitrary
  `returnUrl` from an unauthenticated caller would be an open redirect with a
  payment attached. `app` means the admin app's `/login`, `landing` (the
  default) means the landing site's confirmation page.
- **No mobile is asked for**, as on the renewal card: `mobile` is optional on
  `ResumeSignupDto` now, and Cashfree's customer phone comes from the clinic
  record, or from a placeholder when there is no practice yet.
- **After payment the doctor signs in again.** The password was never carried
  across the redirect, so the screen prefills the address from the order and
  asks for the password. Cheaper than any scheme for smuggling a credential
  through a payment gateway and back.
- **Staff are not offered this.** A receptionist cannot buy the clinic's plan —
  a cycle on their user id would cover nobody — so their refusal says "ask the
  doctor to choose a plan" and carries no `canSubscribe`; `resume` refuses a
  non-doctor account anyway.
- **A deactivated account cannot buy either.** `resume` refuses when
  `is_active` is false: it cannot sign in whatever it pays, and taking money for
  access that is withheld for an unrelated reason is the one outcome here worth
  going out of the way to prevent.
- **An account that already has a live plan** is told to sign in rather than
  sold a second cycle, and an unknown `order_id` in the URL is ignored rather
  than dressed up as a payment that failed.

## Temporary passwords

An account opened by an admin carries `users.must_change_password`. While it is
set, `TemporaryPasswordGuard` answers `PASSWORD_CHANGE_REQUIRED` to every
authenticated route except `GET /auth/me` and `POST /auth/change-password`, and
the admin app turns that into a forced change-password screen.

Enforced on the server, not in the app: a screen the client is asked to show is
a screen the client can skip, and the password in question travelled through an
inbox in plain text as the only credential on a new account. Any password write
clears the flag — the forced screen, Forgot password, anything — so there is one
place the obligation is discharged.

The sign-in form hands the password just typed to the forced screen through
router state, so it need not be copied out of the email twice. Nothing is
stored; a reload empties the field.

Doctors who chose their own password at sign-up are never flagged.

## Renewing a plan

A plan may be renewed from **7 days before it ends** (`RENEW_WINDOW_DAYS`),
from a card on the Billing screen. Early enough that renewing is a decision
rather than an emergency, late enough that a doctor on a yearly plan is not
followed around by a button for eleven months.

- `GET /billing/me/renewal` — whether the window is open, when it opens, when a
  renewal bought now would start, and the plans on sale.
- `POST /billing/me/renew` — opens a Cashfree order for the signed-in doctor.
  Refused outside the window, with the date it opens. Refused for a staff
  account: a cycle bought on a receptionist's user id would cover nobody. Unlike
  the landing page's `resume` it needs no email or password — the account renewed
  is whichever one holds the token — **and, since 25 Sep 2026, no mobile number
  either.** Cashfree will not open an order without a customer phone, but nothing
  here uses one: the receipt, the invoice and the confirmation all go to the
  address the doctor signs in with. So the card asks for a plan and nothing else,
  and `SubscriptionsService.checkoutPhone` fills the gateway's field from the
  clinic record, falling back to a placeholder when the practice has not been set
  up yet. The DTO still accepts `mobile` so an older build of the app keeps
  working.
- `GET /billing/me/orders/:orderId` — scoped to the caller. The landing page's
  version is public because the buyer has no session yet; this one has.

**The new cycle stacks.** `activate` starts a renewal at the current cycle's
`ends_at` rather than today, so paying early never costs the doctor days. The
Billing card says so, because the fear of losing paid-for days is exactly what
makes people wait until the last day.

`GET /billing/me` therefore returns `current` (the cycle covering today) and
`upcoming` (cycles paid for that have not started). Folding them together would
tell a doctor their plan runs to a date the one they are actually on does not
reach.

Cashfree returns the doctor to `/billing?order_id=…`, which polls the order
until it settles and then refreshes the plan and invoice list. Nothing is
believed because the browser came back — only because the API says so.

**An expired doctor cannot use this.** The JWT strategy refuses every
authenticated route without an active plan, so an account that has already
lapsed cannot sign in to renew; it buys its next plan from the sign-in screen
instead (see **Activating an account from the sign-in screen**), which runs on
the public `resume` route. In-app renewal serves the last week of a running
plan; the sign-in screen serves everything after it has run out.

## Invoices

One row per subscription that money was actually taken for, raised once at the
moment the payment is confirmed and never edited. Granted plans get no invoice:
nothing was charged, and a zero-rupee tax invoice would be a lie.

- **Numbering.** `PREFIX/2026-27/0001`, restarting each Indian financial year
  (April–March). `(fy, seq)` is unique; a collision between two payments
  confirmed at once is retried against a freshly read maximum.
- **Snapshots.** The issuer block, the buyer block, the plan name and the tax
  split are all copied into the row. An invoice has to keep saying what it said
  on the day it was raised, whatever the company address does afterwards.
- **The PDF** is rendered on demand from that row (`InvoicePdfService`, pdfkit,
  one A4 page). Nothing is stored, so there is nothing to keep in sync.
  Amounts print as `Rs.` — pdfkit's Helvetica has no `₹` glyph and would draw a
  black box.
- **Tax presentation.** CGST + SGST when the buyer's state matches the issuer's,
  IGST when it does not, and a single GST line when the buyer's state is not
  known — which it usually is not, since the clinic address arrives after the
  payment. Guessing the wrong head would be worse than not splitting.

Issuer details live in Settings (`invoice_*` keys), not in env vars: they are
business facts the super admin owns and changes without a deploy. Until a GSTIN
is entered the document is headed **INVOICE** rather than **TAX INVOICE**.

## Screens

- **Billing** (`/billing`, doctor-owner only — staff accounts do not see it):
  current plan, any cycle queued behind it, the renewal card in the last week,
  the invoice table with per-row download, and past cycles.
- **Change password** (`/change-password`), the forced screen an invited doctor
  meets before anything else.
- **Profile → My plan** shrank to a summary that links to Billing, so the
  receipts live in one place rather than two.
- **Doctors → Invite doctor**, with the plan picker and the one-time
  credentials dialog.
- **Settings → Invoice details**, the issuer block.

## API

| Route | Who |
| --- | --- |
| `POST /doctors/invite` | super admin |
| `GET /signup/plans` | anyone — also the admin sign-in screen |
| `POST /signup/resume` | anyone with an account's email and password |
| `GET /signup/orders/:orderId` | anyone holding the order id |
| `GET /billing/me/renewal` | the doctor |
| `POST /billing/me/renew` | the doctor |
| `GET /billing/me/orders/:orderId` | the doctor, own only |
| `GET /billing/me/invoices` | the doctor, own only |
| `GET /billing/me/invoices/:id/pdf` | the doctor, own only |
| `GET /billing/invoices` | super admin, all |
| `GET /billing/invoices/:id/pdf` | super admin, all |

`GET /billing/me` also returns `renewUrl` now, so the admin app does not need
to know the landing site's address.

## Migrations

- `20260924000002-invoices-and-doctor-invites.js` — the `invoices` table and
  `users.invited_by`.
- `20260924000003-forced-password-change.js` — `users.must_change_password`.

The login gate needed no migration: it reads `users.type` and `users.doctor_id`,
which every account already has. **It takes effect the moment the server
restarts** — every doctor without a live plan, including ones who have been
signing in for months, is refused from then on. Grant those accounts a plan from
**Subscriptions** before deploying, or they will be locked out.

## Not done, deliberately

- **A lapsed plan does not close the clinic's public booking page.** The Billing
  screen says "your booking page is not taking appointments", and the doctor is
  indeed locked out of the app, but `/d/:slug` and the patient web app still
  answer for any doctor whose `is_enabled` is true — nothing ties that to a live
  subscription. Closing it is a business decision about patients who are not the
  ones who stopped paying, so it is left for a deliberate change rather than
  smuggled in with the login gate.

- **No expiry reminder email.** The renewal card appears in the app in the last
  week, but a doctor who does not sign in that week hears nothing. A scheduled
  "your plan ends on X" mail is the obvious next step.
- **A super admin resetting a doctor's password does not flag the account.**
  Same situation as an invite — somebody else chose the password — but it was
  not asked for, and it would change a flow doctors already use.
- **Buyer GSTIN and address** are not collected anywhere, so an invoice carries
  the clinic address only if the doctor had already set their practice up —
  which, for the first payment, they had not. A doctor who needs input credit
  will ask for a GSTIN field.
- **No credit notes or refunds.** Cancelling a subscription does not reverse
  its invoice; refunds are still handled outside the platform.
