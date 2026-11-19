# Manual QA script

Start: `npm start`, open http://localhost:3000 in a fresh private window. Repeat key steps at 375 px width (phone) and desktop.
Mock mode assumed. Demo password for all accounts: `Demo@123`.

## A. Homeowner – happy path (pay in full)

| # | Action | Expected |
|---|---|---|
| 1 | Open `/` → **Start my quote** | Wizard opens at *Step 1 of 7 · Budget*, white UI with a single blue accent, "Demo mode" banner at top |
| 2 | Leave total budget 9000, **Next** | Step 2 |
| 3 | Type `1100 Cong` in Street | Suggestion dropdown appears; click it → city/state/ZIP fill, green "we install in your area" |
| 4 | Change ZIP to `90210` | Amber "outside service area" message; **Next** shows ZIP error and does not advance |
| 5 | Enter `<script>x</script>` as street, **Next** | Street error; nothing executes |
| 6 | Restore `1100 Congress Ave`, ZIP `78701`, pick home size, **Next** | Step 3 with 9 cards under Goodman/Rheem/Trane; badges "Fits your budget / A small stretch / Over budget" |
| 7 | Tick *Hide systems over budget* | Over-budget cards vanish |
| 8 | Select Goodman *Better*; change tonnage | "Your installed price" updates (value comes from the server) |
| 9 | **Next** → toggle 2–3 add-ons | Live total updates each toggle; untoggle reduces it |
| 10 | **Back** twice, then **Next** twice | Choices preserved everywhere |
| 11 | Step 5: **Pay in full** → **Next** | Review shows itemised lines, subtotal, 8.25 % tax, total, 10 % deposit, balance |
| 12 | Enter name `A`, bad email → **Continue** | Field errors shown |
| 13 | Enter valid name/email/phone → **Continue** | Step 7 with deposit amount |
| 14 | Click **Lock my price & pay** | Redirects to demo card form showing the same deposit amount |
| 15 | Pay with `4000 0000 0000 0002` | "Your card was declined." stay on form |
| 16 | Pay with `4242 4242 4242 4242`, `12/40`, `123` | Success page: reference `AC-XXXXXXXX`, locked price, expiry (7 days out), progress complete |
| 17 | Click **Verify my locked price** | `/verify` shows green "Valid price lock" with the same numbers |
| 18 | Edit the `token=` in the URL (change one character) | "We couldn't verify this link" |

## B. Homeowner – financing

| # | Action | Expected |
|---|---|---|
| 1 | New quote, budget type **Monthly**, 150; reach step 5 → **Finance it** | Three terms (12/36/60) with monthly payments and APR |
| 2 | Choose 12 months → **Check my financing** | Red "Not approved" with reason, buttons *Try 60 months* / *Pay in full instead* |
| 3 | **Next** with a declined term | Blocked with message |
| 4 | **Try 60 months** → **Next** | Approved (green); review shows `$x/mo × 60` |
| 5 | Complete lock + payment | Success page mentions financing term and "pre-approved" |
| 6 | Use a very large system + all add-ons (> $15,000 financed) | Status **Pending review**; you can still lock and pay |
| 7 | **Pay in full instead** | Returns to full-payment flow, financing decision cleared |

## C. Edge cases

- Reload mid-wizard → same step and choices restored.
- On the card form click **Cancel and go back** → returns to step 7, lock still valid, can pay again.
- Pay the same locked quote twice (re-open the card URL after success) → redirected to success; never double-charged.
- Wait > 7 days (or set `priceLockDays` to 1 and edit the token's `exp` in a test) → verify shows "expired".
- Stop and restart the server, open the old `/verify?token=…` link → still valid (signature-based).

## D. Sales role

| # | Action | Expected |
|---|---|---|
| 1 | Visit `/sales` signed out | Redirected to `/login` |
| 2 | `/login` → **Demo as… Sales** → fields autofill → **Sign in** | Lands on `/sales` |
| 3 | Review the table | Quotes from section A/B with status pills (locked / paid / expired), totals tiles |
| 4 | Filter by status *Paid*, brand, date, search by ref/email/ZIP | Table updates; **Reset** clears |
| 5 | Click a row | Drawer with customer, address, itemised quote, deposit/payment, financing decision, CRM deal id, notifications |
| 6 | **Export CSV** | `quotes.csv` downloads with the current filters; open in a spreadsheet - names starting with `=` appear as text |
| 7 | Visit `/admin` | Redirected to `/login?denied=1` with "no access" message |
| 8 | **Sign out** | Back to `/login`; `/sales` redirects again |

## E. Admin role

| # | Action | Expected |
|---|---|---|
| 1 | **Demo as… Admin** → **Sign in** | Lands on `/admin`; can also open `/sales` |
| 2 | Catalog tab: change a base price, **Review changes** | Diff `systems.N.basePrice: old → new`, nothing saved yet |
| 3 | **Confirm & save** | "Saved". New quote in another window uses the new price; previously locked quotes unchanged |
| 4 | Enter a negative price or blank name → **Review changes** | Validation list, no save |
| 5 | Pricing tab: set tax 9 %, remove a service ZIP → review → confirm | Applied to new quotes; removed ZIP is now "outside service area" |
| 6 | Integrations tab | Five adapters, all *mock*; **Switch to live** disabled with "Live needs: …" until env is set |
| 7 | Audit log tab | Entries: `login`, `login_failed`, `price_lock`, `payment_session`, `payment`, `admin_change`, `export`; filter by type |
| 8 | CRM & email queue tab | Recent jobs `done`; mock outbox shows customer confirmation (with verify link) and sales notification |
| 9 | Start the server with `MOCK_FAILURE_RATE=0.6`, create a quote | Jobs show `retrying` with attempts and next-attempt times; customer flow is never blocked; permanent failures land in the Failure log |

## F. Security spot checks

- Login with a wrong password 5× → "Too many failed attempts" (even with the right password afterwards for 15 min).
- `curl -X POST localhost:3000/api/quote -H 'content-type: application/json' -d '{}'` → `403 csrf_invalid` (no CSRF token).
- Browser DevTools → Network: no request ever carries a price from the client; `POST /api/quote` bodies contain ids only.
- DevTools → Console on every page: no CSP violations.
- `curl -i localhost:3000/login` shows `Content-Security-Policy` without `unsafe-inline`.
- Webhook spoof: `curl -X POST localhost:3000/api/webhooks/stripe -d '{}'` → `400 invalid_signature`.
- `DEMO_AUTOFILL=false npm start` → `/login` has no "Demo as…" buttons.

## G. Live-mode smoke test (after configuring keys)

1. Stripe test mode: full flow with `4242…`; confirm the Checkout page loads, success page shows paid, webhook delivery is 200 in the dashboard, replaying the event from the dashboard returns `duplicate: true`.
2. HubSpot: contact + deal created at lock, stage moves on payment.
3. SendGrid/Twilio: customer email (and SMS) received, link opens `/verify`.
4. Google Places: typing an address shows real suggestions; selecting one fills ZIP and runs the service-area check.
