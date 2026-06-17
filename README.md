# Boko Inventory Planner — SaaS

Multi-tenant Shopify app: merchants connect their store, set a recipient email + schedule, and receive automated restock-recommendation emails. Standalone Next.js app (App Router) on Vercel + Postgres + Resend.

See `inventory-planner-saas-plan.md` for full architecture.

## Status — MVP code complete (Phases 1–5)
- **Phase 1:** scaffold, Prisma schema, env wiring, pure reorder engine (`lib/reorder.js`, 16/16 tests), landing page.
- **Phase 2:** Shopify OAuth (manual, HMAC-verified) + token encryption + mandatory webhooks (app/uninstalled + GDPR).
- **Phase 3:** Admin GraphQL client; orders→velocity + inventory; `/api/shop/data` + dashboard table.
- **Phase 4:** `/api/settings` + settings UI (recipient email, cadence/day/time/timezone, thresholds).
- **Phase 5:** Resend email render/send; hourly cron dispatcher (`/api/cron/run-digests`) with per-merchant timezone matching; "send test now".
- **Remaining (Phase 6):** privacy policy page, run-history UI, rate-limit/backoff hardening, Shopify App Store review prep, optional billing.

All non-UI logic is syntax-checked; full build/runtime validation happens on deploy (needs env + DB).

## Local setup
```bash
npm install
cp .env.example .env        # fill in the values
npm run db:push             # create tables in your Postgres
npm run dev
```

## Required env (see .env.example)
`APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES`, `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `ENCRYPTION_KEY`, `CRON_SECRET`.

Generate secrets: `openssl rand -hex 32` (ENCRYPTION_KEY), `openssl rand -base64 32` (CRON_SECRET).

## Reorder logic
`velocity = unitsSold / lookbackDays` · `daysCover = stock / velocity` ·
`reorderQty = max(0, ceil(velocity × (leadTime + targetCover) − stock))`.
Status: Order now (cover ≤ lead time) · Reorder soon (≤ lead + cover) · Healthy.

## Test the engine
```bash
npm run test:reorder
```
