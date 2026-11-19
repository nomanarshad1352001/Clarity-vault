# Deployment guide

The app is one stateless-ish Node process (see the README's *Known limitations*): run **exactly one instance** until you
replace the in-memory modules with a database/Redis.

## 1. Production environment checklist

Required:

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` = 48+ random bytes hex (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- [ ] `LOCK_TOKEN_SECRET` = a *different* random value (rotating it invalidates all outstanding price locks)
- [ ] `REQUIRE_SECRETS=true` (app refuses to boot without the secrets)
- [ ] `APP_URL=https://your-domain` (no trailing slash)
- [ ] `FORCE_HTTPS=true` and `COOKIE_SECURE=true`
- [ ] `TRUST_PROXY=1` (Render/Railway sit behind one proxy; without it all users share one rate-limit bucket)
- [ ] `DEMO_AUTOFILL=false`
- [ ] Real users in `config/demo-users.json` (or replace auth) - **the demo passwords are public**

Per integration you switch to live: see the README table. Never put keys in the repo; use the platform's secret store.

## 2. Docker (any host)

```bash
docker build -t ac-quote .
docker run --rm -p 3000:3000 --env-file .env -e NODE_ENV=production ac-quote
curl localhost:3000/health
```
The image runs as a non-root user and has a `HEALTHCHECK` on `/health`.

## 3. Render

1. Push the repo to GitHub → Render → **New → Web Service** → select the repo.
2. Runtime **Docker** (uses the `Dockerfile`) *or* Runtime **Node** with Build `npm ci --omit=dev && npm run build`, Start `npm start`.
3. Health check path: `/health`. Instance count: **1**.
4. Environment: add everything from the checklist above (use *Secret Files/Environment groups* for keys).
5. Custom domain: Settings → Custom Domains → add `quote.example.com` → create the `CNAME` Render shows. Render issues the TLS certificate automatically.

## 4. Railway

1. New Project → Deploy from GitHub repo (Railway detects the `Dockerfile`).
2. Variables: add the checklist values. Railway sets `PORT` automatically (the app reads it).
3. Settings → Networking → *Generate Domain* or add a custom domain (`CNAME` to the target shown). TLS is automatic.
4. Settings → Deploy → healthcheck path `/health`; replicas **1**.

## 5. HTTPS & domain notes

- Terminate TLS at the platform (Render/Railway do this); the app sees plain HTTP behind the proxy, which is why `TRUST_PROXY=1` matters.
- With `FORCE_HTTPS=true` the app sends HSTS (1 year, includeSubDomains) and CSP `upgrade-insecure-requests`. Only enable once HTTPS works on the final domain, because browsers cache HSTS.
- `COOKIE_SECURE=true` makes session and CSRF cookies HTTPS-only.
- Stripe webhook URL must be the public HTTPS URL: `https://your-domain/api/webhooks/stripe`.
- Redirect `www` ↔ apex at your DNS/CDN provider. If you put Cloudflare in front, keep proxying on and set `TRUST_PROXY=2`.

## 6. Go-live checklist

**Data**
- [ ] Replace `config/catalog.json` with real products, prices, warranties, images (put real images in `public/img/`).
- [ ] Replace `config/pricing-rules.json`: real tax rate(s), deposit %, lock days, lender APRs/terms, service-area ZIPs, home-size multipliers, tonnage surcharges.
- [ ] Have finance/legal review financing disclosures (`adapters/financing.js` `getTerms`) and the deposit/refund language shown in the UI and emails.
- [ ] Replace demo users; remove `DEMO_AUTOFILL`; confirm no `Demo@123` login works.

**Integrations**
- [ ] Stripe: switch to live keys *only* after a full test-mode pass; set `STRIPE_ALLOW_LIVE_KEYS=true` deliberately; configure the production webhook and verify a delivery in the Stripe dashboard.
- [ ] HubSpot private app created, pipeline/stage ids set, one test deal appears and moves to the paid stage.
- [ ] SendGrid sender verified (SPF/DKIM), SMS opt-in/consent copy approved if using Twilio.
- [ ] Google Places key restricted to Places API (New) and to your server IPs.
- [ ] Lender adapter implemented and sandbox-tested.

**Platform**
- [ ] All env vars from section 1 set; secrets are random and stored only in the platform secret store.
- [ ] HTTPS works on the final domain; then enable `FORCE_HTTPS` / `COOKIE_SECURE`.
- [ ] Single instance + health check `/health` green; alerts on failures.
- [ ] Decide persistence: add a database (see README *Replacing modules*) **before** taking real money - in-memory orders are lost on restart.
- [ ] `npm audit --omit=dev` clean; `npm test` and `npm run build` green in CI.
- [ ] Log drain configured (logs contain no PII by design, but verify with a test order).
- [ ] Run the full [QA script](QA.md) against the production URL using Stripe test cards, then once with a real card for the minimum deposit and refund it.
