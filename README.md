# AireDirect — self-serve AC pricing

Homeowners price a new AC system online with **no sales visit**: set a budget → enter an address → choose a Goodman, Rheem or Trane system → pick add-ons → pay in full or finance → pay a deposit → lock the price for 7 days.

> ⚠️ **All catalog data and pricing rules are placeholders** (`config/*.json`) — replace them with real business data before go-live. The app runs in **demo mode**: mock payments, mock financing, mock CRM/email/SMS/address lookups, demo user accounts, and an in-memory order store that resets on restart.

## Quick start

Two ways to run the **same** Express application:

| Mode | Command | URL | Notes |
| --- | --- | --- | --- |
| Standalone (recommended for Docker/Render/Railway) | `node server/index.js` | http://localhost:4000 | Express serves `/public` + `/api` itself, with helmet CSP |
| Hosted (this sandbox / Next.js platform) | `npm run build && npm start` | http://localhost:3000 | `pages/api/[[...all]].js` mounts the Express app; CSP comes from `next.config.ts` |

First time: `cp .env.example .env` and fill in at least `JWT_SECRET`, `LOCK_SECRET`, `CSRF_SECRET` (any random hex works: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).

**Demo logins** (all password `Demo@123`): `homeowner@demo.com` → `/quote` · `sales@demo.com` → `/sales` · `admin@demo.com` → `/admin`.

**Run the tests:** `node --test tests/*.test.js` — 39 tests covering pricing math, price-tampering, token expiry, CSRF, role guards, rate limiting, webhook spoofing and replay, and bad address input.

## Architecture

```
config/                  # NO DATABASE — versioned JSON is the source of truth
  catalog.json           #   3 brands × 3 tiers, 8 add-ons        (PLACEHOLDER DATA)
  pricing-rules.json     #   tax, deposit %, lock days, terms,    (PLACEHOLDER DATA)
                         #   service-area ZIPs, home-size multipliers, tonnage deltas
  demo-users.json        #   bcrypt-hashed demo accounts
server/
  app.js                 # Express assembly (used by BOTH run modes)
  index.js               # Standalone entry (node server/index.js)
  configStore.js         # JSON config loader/cache + adapter mode selection
  schemas.js             # zod schemas — strict validation of every input
  securityHeaders.js     # shared CSP (mirrored in next.config.ts)
  logger.js              # JSON logs with PII/JWT redaction
  middleware/            # auth (JWT session cookie), csrf (HMAC of session),
                         # rateLimit (in-memory buckets), validate (zod)
  services/
    pricing.js           # THE ONLY place prices are computed
    quoteLock.js         # signed, expiring JWT price locks (LOCK_SECRET)
    store.js             # in-memory orders + audit log + webhook idempotency
    retryQueue.js        # exponential-backoff queue for integration jobs
    integrations.js      # CRM/email/SMS fan-out on lock & payment
  adapters/              # every external system: mock + live, chosen by env var
    payments.js          #   mock card gateway | Stripe Checkout + webhook
    financing.js         #   mock lender | LiveFinancing stub (interface ready)
    crm.js               #   mock | HubSpot
    email.js             #   mock | SendGrid
    sms.js               #   mock | Twilio
    address.js           #   mock suggestions | Google Places (area check always local)
  routes/                # auth, catalog, quote, payments, financing, orders,
                         # admin, address, misc (health + app-config)
pages/api/[[...all]].js  # Next.js host adapter (only used by `npm start`)
public/                  # plain HTML/CSS/JS frontend — no framework, no build
  login.html  quote.html  sales.html  admin.html  verify.html  payment-success.html
  assets/css/app.css     # design system (white, one arctic-blue accent, mobile-first)
  assets/js/*.js         # ES modules; shared.js = API client + icons + chrome
tests/                   # node:test — no extra dependencies
docs/                    # DEPLOYMENT.md (Render/Railway/Docker) · QA.md (manual script)
Dockerfile               # standalone Express production image
```

**Server-side pricing, always.** The browser sends IDs and quantities only. `POST /api/quote`, `POST /api/quote/lock` and `POST /api/payments/deposit` all recompute money from `config/*.json` on the server. The deposit amount comes out of the *signed lock token*, never the request body.

## Pricing math (server/services/pricing.js)

```
systemPrice  = (baseInstalledPrice + tonnageDelta) × homeSizeMultiplier
subtotal     = systemPrice + Σ addOns
tax          = subtotal × taxRate                    (8.25% placeholder)
total        = subtotal + tax
deposit      = total × depositPercent                (10% placeholder)
financing    = standard amortization of (total − deposit) at the term APR:
               M = P·r / (1 − (1+r)^−n),  r = APR/12 (0% APR → P/n)
```

## Price locks

`POST /api/quote/lock` re-computes the quote, then signs it with `LOCK_SECRET` into a JWT that expires after `pricing-rules.priceLockDays` (7). `GET /api/quote/verify?token=…` is public and validates signature + expiry — it's the link emailed to the customer (`/verify`). Tampered → `401 LOCK_INVALID`; expired → `410 LOCK_EXPIRED`. Sessions use a **different** secret (`JWT_SECRET`), so neither token can forge the other.

## Adapters — mock ↔ live

| Domain | Env var | Mock behavior | Live provider | Required env for live |
| --- | --- | --- | --- | --- |
| Payments | `PAYMENTS_ADAPTER` | Test-card gateway (below) | Stripe Checkout + webhook | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Financing | `FINANCING_ADAPTER` | Rule-based approve/review/decline | Stub — interface ready (`prequalify`, `getOffer`, `getTerms`) | lender integration TBD |
| CRM | `CRM_ADAPTER` | Logs contact/deal create + stage change | HubSpot v3 | `HUBSPOT_ACCESS_TOKEN` |
| Email | `EMAIL_ADAPTER` | Logs messages | SendGrid | `SENDGRID_API_KEY`, `SENDGRID_FROM` |
| SMS | `SMS_ADAPTER` | Logs messages | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Address | `ADDRESS_ADAPTER` | Synthetic suggestions in service ZIPs | Google Places Autocomplete | `GOOGLE_PLACES_API_KEY` |

Toggling: set the env var (source of truth), or flip at runtime from **Admin → Integrations** (in-memory override, resets on restart, blocked if the live keys are missing). Failed integration calls run through the **retry queue** (2s→4s→8s…, 5 attempts) and land in the audit log as `INTEGRATION_FAILED` — they never block a customer.

### Mock payment test cards

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Approved |
| `4000 0000 0000 0002` | Declined (generic) |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

### Stripe live mode

1. Set `PAYMENTS_ADAPTER=live`, `STRIPE_SECRET_KEY=sk_test_…` and `APP_BASE_URL=https://your-domain`.
2. Webhook: `stripe listen --forward-to https://your-domain/api/payments/webhook` (or add the endpoint in the Dashboard for `checkout.session.completed`) and set `STRIPE_WEBHOOK_SECRET=whsec_…`.
3. The webhook verifies the `stripe-signature` header against the **raw** body and is idempotent (processed event IDs are remembered; replays return `{received:true, duplicate:true}`). `/payment/success` re-checks the session server-side as a UX convenience — the webhook is authoritative.
4. Use Stripe's [test cards](https://stripe.com/docs/testing) in test mode. The client never sends an amount; the deposit is read from the signed lock token.

## Security (Step 9 checklist)

- Rate limiting on all `/api` (600/5 min/IP), stricter on login (10/5 min) and quote endpoints (60/5 min). Buckets in-memory — replace with Redis for multi-instance.
- Session: signed JWT in `httpOnly`, `sameSite=lax` cookie; `secure` auto-set behind TLS (`trust proxy` is on). CSRF: HMAC-of-session token required as `X-CSRF-Token` on every cookie-authenticated mutation (login + webhook exempt).
- Strict CSP (`default-src 'self'`, no inline scripts/styles), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` — via `next.config.ts` (hosted) or helmet (standalone).
- zod validation on every body/query; unknown catalog IDs rejected with 422; CSV export escapes formula-injection; all UI rendering via `textContent`/`escapeHtml`.
- Logs are JSON with PII (email, card, tokens, passwords) and JWT-shaped strings redacted; audit log records logins, locks, payments, financing decisions, admin edits, webhook rejections.
- Secrets only in `.env` (git-ignored); nothing secret is shipped to the browser. `.env.example` documents every variable.
- `npm audit`: 0 high/critical. 4 moderate remain in **dev-only** tooling (`eslint` → minimatch/@humanfs, `drizzle-kit` → esbuild); none ship in the production runtime.

## Adding a real database later (Step 10)

The code is organized so a database replaces exactly these modules — no route or UI changes:

1. **`server/services/store.js`** — swap Maps/arrays for tables: `orders`, `audit_log`, `webhook_events` (idempotency). Keep the exported function signatures.
2. **`server/configStore.js` → `getDemoUsers()`** — replace `config/demo-users.json` with a `users` table (keep bcrypt hashes). Catalog/pricing can stay as JSON or move to tables behind the same getters.
3. **`server/middleware/rateLimit.js`** — move buckets to Redis for multi-instance deployments.
4. **`server/services/retryQueue.js`** — persist jobs (table or a queue like BullMQ) so retries survive restarts.
5. **`server/configStore.js` adapter overrides** — persist runtime toggles if you keep that feature.
6. **`server/middleware/auth.js`** — JWT sessions can stay stateless; add a `sessions`/`refresh_tokens` table only if you need revocation.

## Go-live checklist

- [ ] Replace placeholder data in `config/catalog.json` + `config/pricing-rules.json` with real pricing.
- [ ] Replace `config/demo-users.json` with a real identity store; remove the "Demo as…" buttons (`DEMO_AUTOFILL=false`) and the banner (`DEMO_BANNER=false`).
- [ ] Rotate `JWT_SECRET`, `LOCK_SECRET`, `CSRF_SECRET` (any rotation invalidates outstanding sessions/locks — expected).
- [ ] Set `APP_BASE_URL` to the public HTTPS origin; confirm `secure` cookies behind the platform TLS proxy.
- [ ] Switch adapters to `live` as credentials arrive (payments last, after webhook testing in Stripe test mode).
- [ ] Run `node --test tests/*.test.js` and the manual script in `docs/QA.md`.
- [ ] Re-run `npm audit` after any dependency change.

## Docs

- `docs/DEPLOYMENT.md` — Dockerfile, Render/Railway guides, HTTPS/domain notes, production env checklist.
- `docs/QA.md` — manual QA script covering the full flow for all three roles.

## Design system — "Linen"

Built to the client's reference: cream app screens resting on peach linen.

- **Layout:** homeowner screens (`/login`, `/quote`, `/verify`, `/payment/success`) render inside a phone frame on desktop/tablet and go full-screen (with safe-area insets) on real phones. Staff dashboards (`/sales`, `/admin`) use a wide cream panel on the same linen.
- **Anatomy of every screen:** shield-and-lock logo with a two-line serif wordmark (top-left) · centered title with a thin progress line · two-line hamburger (opens a slide-down menu) · sand "pill" badge · large rounded card with a serif question · soft neumorphic **orb** as the primary action · one line of microcopy underneath.
- **Type:** Source Serif 4 (headings, prices) + DM Sans (UI), both self-hosted variable fonts (SIL OFL).
- **Palette:** cream `#FCF1EA`, sand `#F5E5DA`, taupe `#C2A592`, espresso ink `#2A1E18`; sage / honey / clay for status only.
- **Motion:** directional step transitions, staggered reveals, breathing orb halo, sliding segmented thumbs, number morphs and count-ups, ripple + haptic taps, live card preview that flips for the CVC, and a warm confetti burst on confirmation. Everything honours `prefers-reduced-motion`.
- **CSP-safe:** no inline `style` attributes anywhere; dynamic values are set through CSSOM only.

## Media credits

`public/assets/media/linen.jpg` is an AI-generated linen texture created for this project. The fonts are open-source (SIL Open Font License).
