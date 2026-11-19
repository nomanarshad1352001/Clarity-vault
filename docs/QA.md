# Manual QA script

Run against a fresh boot (`node server/index.js` or the hosted preview). Check every box for all three roles.

## 1. Login & roles

- [ ] `/` redirects to `/login`. Demo banner is visible (when `DEMO_BANNER=true`).
- [ ] Each **Demo as…** button autofills email + password; Sign In works. (`DEMO_AUTOFILL=false` hides the buttons.)
- [ ] Wrong password shows an inline error and is rate-limited after repeated attempts (429).
- [ ] Homeowner lands on `/quote`, Sales on `/sales`, Admin on `/admin`.
- [ ] Homeowner visiting `/sales` or `/admin` is redirected to `/quote`. Sales visiting `/admin` is redirected.
- [ ] Sign out clears the session; protected pages redirect to `/login`.

## 2. Homeowner quote flow (`/quote`)

- [ ] Progress bar shows 7 steps; current step highlighted; completed steps clickable.
- [ ] Budget: monthly/total toggle; slider and displayed value stay in sync.
- [ ] Address: typing shows suggestions; selecting one fills street + ZIP. ZIP `90210` (outside area) shows the friendly "not serving" message and blocks Next. ZIP `75201` passes with a green confirmation.
- [ ] System step: 3 brands × 3 tiers; budget-fit chips appear; changing tonnage changes the estimate; selecting a card shows the blue ring + check.
- [ ] Back/Next preserve every choice (also after a full page refresh — sessionStorage).
- [ ] Add-ons: toggles update the running total bar.
- [ ] Payment: Pay-in-full shows the server total; Financing shows monthly per term; switching terms refetches the server quote.
- [ ] Financing decline path: set a monthly budget below the payment → decline panel offers "Try a longer term" and "Pay in full instead"; both work. A tiny budget (e.g. $40) → declined; generous ($500) → pre-approved.
- [ ] Review: itemized receipt (system, adjustments, add-ons, subtotal, 8.25% tax, total, 10% deposit) matches server math.
- [ ] **Lock this price** → returns reference `AQ-XXXXXXXX`; wizard advances to deposit.
- [ ] Deposit: test card chips fill the form. `4242…` succeeds → confirmation with ref, locked total, expiry date, verification link. `4000…0002` → declined message, order stays locked, retry works.
- [ ] Confirmation: copy-ref button works; the verification link opens `/verify` showing the lock as valid.
- [ ] Tamper test: change one character of the token in the `/verify` URL → "Invalid price lock".

## 3. Sales dashboard (`/sales`)

- [ ] Table lists the orders created above with status badges (locked/paid).
- [ ] Status filter and search (by ref, email, system) work.
- [ ] Row click opens the detail drawer: customer, itemized quote, payment ID, CRM deal id (mock id after retry queue runs ~1s).
- [ ] Export CSV downloads; opening it shows all orders; a ref starting with `=` would be escaped (formula-injection guard).
- [ ] Stats row counts match the table.

## 4. Admin dashboard (`/admin`)

- [ ] **Catalog:** change Goodman GSX14 base price 5495 → 5595 → Save → confirm modal lists the diff → Confirm → toast. Verify: a new quote on `/quote` shows the new price (server recomputed).
- [ ] **Pricing rules:** change deposit 10% → 15% → confirm → save. Verify: review step shows 15% deposit. Restore afterwards.
- [ ] Validation: enter tax 99% → server rejects with 400 and a field error.
- [ ] **Integrations:** each card shows mode + required env vars. "Switch to live" without keys → 422 listing missing vars. Mock→mock toggle succeeds and logs to audit.
- [ ] **Audit log:** shows LOGIN, PRICE_LOCKED, FINANCING_DECISION, PAYMENT_SUCCEEDED, ADMIN_* entries with timestamps and actors.

## 5. Security spot-checks

- [ ] View source: no inline scripts/styles; CSP header present on pages (`default-src 'self'`).
- [ ] DevTools: POST `/api/quote` with curl/fetch without the `X-CSRF-Token` header (but with the session cookie) → 403.
- [ ] `GET /api/orders` signed out → 401; as homeowner → 403.
- [ ] `node --test tests/*.test.js` → all pass.
- [ ] Server logs show no emails, card numbers, or tokens (redacted).
