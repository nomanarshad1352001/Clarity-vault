# Deployment guide

The app ships as a self-contained Node/Express server (`node server/index.js`) that serves both the API and the static frontend. A Dockerfile is included.

## Production env checklist

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `APP_BASE_URL` | `https://app.yourdomain.com` | Used in email links + Stripe redirect URLs. Must be the public HTTPS origin so session cookies get `Secure`. |
| `PORT` | platform-assigned | Render/Railway inject `PORT`; the server reads it. |
| `JWT_SECRET` / `LOCK_SECRET` / `CSRF_SECRET` | 96-char random hex | Generate per environment; rotating invalidates sessions/locks. |
| `DEMO_BANNER` | `false` | Hides the demo banner. |
| `DEMO_AUTOFILL` | `false` | Hides the "Demo as…" autofill buttons on the login page. |
| `PAYMENTS_ADAPTER` | `live` when ready | Requires Stripe keys + webhook (below). |
| `FINANCING_ADAPTER` | `mock` | Live lender interface is ready, not yet wired to a provider. |
| `CRM_ADAPTER` | `live` + `HUBSPOT_ACCESS_TOKEN` | Private-app token with contacts/deals scopes. |
| `EMAIL_ADAPTER` | `live` + `SENDGRID_API_KEY`, `SENDGRID_FROM` | Verify the sender domain in SendGrid. |
| `SMS_ADAPTER` | `live` + `TWILIO_*` | Optional. |
| `ADDRESS_ADAPTER` | `live` + `GOOGLE_PLACES_API_KEY` | Restrict the key to the Places API. |
| `SALES_NOTIFY_EMAIL` | real inbox | Internal notifications. |
| `RATE_LIMIT_*` | optional overrides | `RATE_LIMIT_API_MAX`, `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_QUOTE_MAX`. |

Never commit `.env`. Set these in the platform dashboard.

## Render

1. New → **Web Service** → connect the repo.
2. Runtime: **Node**. Build command: `npm ci`. Start command: `node server/index.js`.
3. Add every env var above. Render provides `PORT` automatically.
4. Health check path: `/api/health`.
5. (Alternative) choose **Docker** runtime — the included `Dockerfile` is production-ready.

## Railway

1. New project → **Deploy from repo**.
2. Railway detects the `Dockerfile` (or use builder `NIXPACKS` with start command `node server/index.js`).
3. Add env vars; Railway injects `PORT`.
4. Attach a domain (Settings → Networking → Generate domain) and set `APP_BASE_URL` to it.

## Docker (any host / fly.io / ECS)

```bash
docker build -t airedirect .
docker run -p 4000:4000 --env-file .env airedirect
```

Health check: `GET /api/health` → `200 {"status":"ok",…}`.

## HTTPS & domains

- Terminate TLS at the platform (Render/Railway/managed load balancer all do this automatically). The app sets `trust proxy` and marks cookies `Secure` when the request arrives over HTTPS (`X-Forwarded-Proto`).
- Point DNS `A`/`CNAME` per the platform's instructions, then set `APP_BASE_URL` to the final `https://` origin **before** enabling Stripe live mode — Checkout success/cancel URLs are derived from it.
- Add HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`) at the platform/edge once you confirm HTTPS-only works. It is intentionally not set by the app to keep local HTTP development painless.
- The CSP allows `form-action https://checkout.stripe.com` already; no other third-party browser connections are used (Stripe.js is not loaded — Checkout is a server-side redirect).

## Stripe webhook setup (live payments)

1. Dashboard → Developers → Webhooks → Add endpoint: `https://app.yourdomain.com/api/payments/webhook`, event: `checkout.session.completed`.
2. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Test locally with the CLI: `stripe listen --forward-to localhost:4000/api/payments/webhook` then `stripe trigger checkout.session.completed`.
4. The endpoint verifies signatures, ignores replays (idempotent), and marks the order paid by the `ref` in session metadata. It never trusts client-supplied amounts.
