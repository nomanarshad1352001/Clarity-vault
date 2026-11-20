# Self-serve AC pricing & price-lock tool

Homeowners price a new AC online with no sales visit:
**budget → address → system (Goodman / Rheem / Trane) → add-ons → pay in full or finance → deposit → locked price.**

> ## ⚠️ ALL DATA IS PLACEHOLDER
> Every value in `config/catalog.json`, `config/pricing-rules.json` and `config/demo-users.json`
> (products, prices, tax rate, APRs, service-area ZIPs, multipliers, demo logins) is a made-up example.
> **Replace them with real values before go-live** (see the [go-live checklist](#go-live-checklist)).

## Hard rules this project follows

| Rule | How |
|---|---|
| No database | JSON config files, signed JWT price locks, in-memory demo orders |
| Node + Express, plain HTML/CSS/JS | `/server` (Express 5) and `/public` (no framework, no build step) |
| Prices only computed on the server | `server/services/pricing.js`; strict zod schemas reject any client-sent price |
| Every external system behind an adapter | `server/adapters/*` each have a `mock` and `live` implementation chosen by env var |

> **Note on `app/` and `next`:** the sandbox this was built in runs `next typegen` as a validation step, which needs an
> `app/` folder and the `next` package. They are an inert shim: **nothing in this project uses Next.js**.
> In your own repo you can delete `app/`, uninstall `next`, and drop that check. Until then, `vercel.json` pins the
> framework preset to `express` so Vercel does not try to run a Next.js build (which would fail with
> `NEXT_NO_ROUTES_MANIFEST`).

## Quick start

```bash
npm install
cp .env.example .env          # optional - works with defaults (mock everything)
npm start                      # http://localhost:3000   (npm run dev = auto-restart)
npm test                       # 25 tests: pricing, tokens, security
npm run build                  # validates config JSON, syntax-checks JS, enforces the no-inline-script CSP rule
```

Demo logins (password `Demo@123`): `homeowner@demo.com` → `/quote`, `sales@demo.com` → `/sales`, `admin@demo.com` → `/admin`.
On `/login`, the **Demo as…** buttons autofill these (hidden when `DEMO_AUTOFILL=false`).

## Architecture

```
server/
  index.js            boot + graceful shutdown
  app.js              middleware order, routes, role-gated pages
  config.js           env parsing (secrets are derived/validated here)
  routes/             public (config, catalog, address) · auth · quote (quote, lock, verify, financing) · payment (+webhook) · staff (sales, admin)
  services/
    pricing.js        THE pricing engine (cents, tax, deposit, amortization, budget fit)
    schemas.js        zod schemas for requests and for the config files
    tokens.js         price-lock + session JWTs (separate secrets AND audiences)
    orders.js         in-memory orders  ← replace with DB
    audit.js          in-memory audit log ← replace with DB
    configStore.js    reads/writes /config/*.json ← replace with DB
    paymentEvents.js  single idempotent "payment succeeded" handler
    integrations.js   what happens on lock / payment (CRM, email, SMS) via the queue
    queue.js          in-memory retry queue, exponential backoff + failure log ← replace with durable queue
    logger.js         JSON logs with PII redaction
  adapters/           payments · financing · crm · notifications · address (+ index.js registry)
  middleware/         security (helmet/CSP) · csrf · rateLimits · auth (requireRole) · errorHandler
public/               static frontend: index, login, quote (wizard), success, verify, pay/mock
views/                role-gated staff HTML (sales, admin) - kept out of public/ so CDNs cannot bypass the guard
config/               catalog.json · pricing-rules.json · demo-users.json
tests/                node:test suites
```

### Request flow

1. `POST /api/quote` — client sends **choices** (ids, ZIP, term). Server validates (zod `strictObject`), calculates, returns an itemised quote in cents.
2. `POST /api/quote/lock` — server recomputes, runs financing pre-qual (if financing), creates the order, signs a JWT (`aud=price-lock`, 7-day `exp`, `jti=ref`) and queues CRM + email/SMS.
3. `POST /api/payment/session {token}` — verify token → server derives the deposit from the signed total → adapter creates session (mock card form or Stripe Checkout). **No amount is ever accepted from the client.**
4. Success page → `GET /api/payment/confirm` and/or the Stripe webhook → `paymentEvents.handleEvent` marks the order paid (idempotent, amount re-checked) and queues CRM stage update + receipts.
5. `GET /api/quote/verify?token=` — anyone with the link can verify signature, expiry and paid status. Tokens contain no personal data.

### API summary

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health`, `/api/health` | – | health check |
| `GET /api/config` | – | safe flags (demo mode, current user) |
| `GET /api/catalog?budget&budgetType&homeSize` | – | catalog + server-computed estimate & budget fit |
| `GET /api/address/suggest?q` · `/details?id` · `/check?zip` | – | address lookup + service-area check |
| `POST /api/quote` · `/api/quote/lock` · `/api/financing/prequalify` | – | pricing, lock, financing decision |
| `GET /api/quote/verify?token=` | – | verify a lock |
| `POST /api/payment/session` · `GET /api/payment/confirm` | – (token / session id) | deposit |
| `POST /api/webhooks/stripe` | signature | payment webhook (raw body) |
| `POST /api/auth/login` · `/logout` · `GET /api/auth/me` | – / cookie | session |
| `GET /api/sales/orders[.csv]` · `/orders/:ref` | sales, admin | dashboard |
| `GET/PUT /api/admin/config,catalog,pricing` · `adapters` · `audit` · `queue` · `outbox` | admin | admin |

## Environment variables

See [`.env.example`](.env.example) — every variable is documented there. Key ones:

| Var | Purpose |
|---|---|
| `JWT_SECRET` (≥32 chars), `LOCK_TOKEN_SECRET` | signing secrets. Missing ⇒ ephemeral random secret (sessions/locks reset on restart); `REQUIRE_SECRETS=true` makes it a hard error |
| `DEMO_AUTOFILL` | `true` shows demo autofill buttons + banner; **`false` in production** |
| `PAYMENTS_MODE`, `FINANCING_MODE`, `CRM_MODE`, `NOTIFY_MODE`, `ADDRESS_MODE` | `mock` \| `live` |
| `APP_URL` | public https URL used in emails and Stripe redirects |
| `TRUST_PROXY`, `FORCE_HTTPS`, `COOKIE_SECURE` | production-behind-proxy settings |

## Switching adapters from mock to live

Set the env var and the credentials, restart (or use **Admin → Integrations**, which refuses to switch until credentials exist; runtime toggles reset on restart).

| Adapter | Env var | Required credentials | Notes |
|---|---|---|---|
| Payments | `PAYMENTS_MODE=live` | `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET` | Stripe Checkout, test mode. `sk_live_` keys are refused unless `STRIPE_ALLOW_LIVE_KEYS=true` |
| Financing | `FINANCING_MODE=live` | `FINANCING_API_URL`, `FINANCING_API_KEY` | `adapters/financing.js` `live` is a generic REST skeleton (`/prequalify`, `/offers`, `/terms`) - adapt to your lender |
| CRM | `CRM_MODE=live` | `HUBSPOT_ACCESS_TOKEN` (+ optional `HUBSPOT_PIPELINE`, `HUBSPOT_STAGE_LOCKED`, `HUBSPOT_STAGE_PAID`) | creates contact + deal on lock, moves stage on payment |
| Email / SMS | `NOTIFY_MODE=live` | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (+ Twilio trio for SMS) | verified sender required in SendGrid |
| Address | `ADDRESS_MODE=live` | `GOOGLE_PLACES_API_KEY` | Places API (New); called server-side so the key never reaches the browser |

**Adapter interfaces** (each `mock` and `live` implement the same functions): see the header comment in each `server/adapters/*.js`.

### Stripe test mode & webhook setup

1. Create a Stripe account → Developers → API keys → copy the **test** secret key to `STRIPE_SECRET_KEY`.
2. Local webhooks: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → copy the printed `whsec_…` to `STRIPE_WEBHOOK_SECRET`.
3. Deployed webhooks: Developers → Webhooks → add endpoint `https://YOUR_DOMAIN/api/webhooks/stripe`, event `checkout.session.completed`, copy the signing secret.
4. Set `PAYMENTS_MODE=live`, `APP_URL=https://YOUR_DOMAIN` (or `http://localhost:3000`), restart.

Test cards: `4242 4242 4242 4242` (success) · `4000 0000 0000 0002` (declined) · `4000 0025 0000 3155` (3-D Secure) · `4000 0000 0000 9995` (insufficient funds). Any future expiry, any CVC, any ZIP.
The mock card form supports `4242…`, `4000 0000 0000 0002` and `4000 0000 0000 9995`.

Webhook safety: signature verified on the raw body; events de-duplicated by id; amount re-derived and compared; unknown orders ignored. In mock mode the webhook accepts an HMAC (`x-mock-signature`) keyed with a secret derived from `JWT_SECRET`.

## Security measures

Rate limits on all `/api` (stricter: login, quote, lock) · per-account login lockout · signed double-submit CSRF + Origin check ·
strict CSP (no inline script/style, same-origin only) via helmet · zod strict validation everywhere · DOM built with `textContent` (never `innerHTML` with data) ·
CSV formula-injection neutralised · bcrypt passwords · httpOnly + SameSite cookies · lock/session tokens use separate secrets and audiences ·
PII-redacting logger (no bodies, queries or headers logged) · in-memory audit log of locks, payments, webhook rejections, admin edits and logins ·
`.env` is git-ignored · `npm audit` is clean.
Tests in `tests/security.test.js` cover price tampering, token replay, webhook spoofing, brute-force login, bad address input, CSRF, RBAC, CSV injection, and client-code secret scanning.

## Replacing modules when you add a real database

| Module | Replace with |
|---|---|
| `server/services/orders.js` | `orders` table (ref PK, status, quote JSON, customer, payment, crm ids). Keep the exported function names |
| `server/services/audit.js` | `audit_log` table (append-only) |
| `server/services/configStore.js` | `catalog`/`pricing` tables or versioned JSON rows; keep `getContext()`, `update()` |
| `server/services/queue.js` | durable queue (BullMQ/SQS/pg-boss) with the same `enqueue(name, fn, opts)` API |
| `server/routes/auth.js` (`USERS`) + `config/demo-users.json` | real users table / identity provider; keep `tokens.signSession` + `requireRole` |
| `server/services/paymentEvents.js` `processed` Set | `processed_events` table (unique event id) |
| `server/routes/auth.js` `failures` Map, rate limiter stores | shared store (Redis) if you run more than one instance |
| `adapters/payments.js` mock `sessions` Map | not needed in live mode |

Everything else (pricing, tokens, schemas, adapters, middleware, frontend) is storage-agnostic.

## Known limitations (by design for the demo)

- Orders, audit log, queue and sessions of the mock card form live in memory: **restart = data loss**, and you can only run **one instance**.
  A valid price-lock token can still be verified and paid after a restart (the order is rebuilt from the signed token, without customer details).
- Admin edits write to `/config/*.json`; on platforms with ephemeral disks they are lost on redeploy. Commit changes to git or add a volume.
- No SSN/credit data is collected. A real lender flow should hand off to the lender's hosted application.

## More docs

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) – Docker, Render, Railway, HTTPS/domain, production env checklist, go-live checklist
- [`docs/QA.md`](docs/QA.md) – manual QA script for all three roles
