# YuziGoods Ops Console

YuziGoods Ops Console is a US-first eBay operations system for:
- CJ product discovery and prefiltering
- eBay demand and competition scoring
- approval-first listing drafts
- worker-driven publish / rollback jobs
- low-risk fulfillment guardrails
- dead-letter queue and kill-switch controls

## Runtime shape

- `web`: Express API + Vite frontend
- `worker`: queue processor for discovery, publish, rollback, and order automation
- `file` storage fallback for local development
- `postgres` storage mode for production via `DATABASE_URL`

## Key behaviors implemented

- CJ prefilter before eBay scoring
- score model with demand, competition, margin, shipping, return-risk, supplier, policy, and complexity inputs
- 30-day AI artifact cache
- daily and monthly AI budget caps with fallback mode
- dead-letter queue for failed jobs
- idempotent CJ fulfillment key generation
- stable seller SKU generation to prevent duplicate drafts
- sandbox-first rollout controls
- emergency kill switch that pauses automation and queues rollback jobs

## Local development

1. Copy `.env.example` to `.env`
2. Set at least:
   - `SESSION_SECRET`
   - `STORAGE_DRIVER=file`
3. Install dependencies:
   - `npm install`
4. Run the web app:
   - `npm run dev`
5. Run a single worker pass:
   - `npm run dev:worker`

## Production deployment

Heroku layout:
- `web: npm run start`
- `worker: npm run worker`

Recommended production env:
- `STORAGE_DRIVER=postgres`
- `DATABASE_URL=<supabase pooled postgres url>`
- `EBAY_ENV=sandbox` for week 1
- `EBAY_ENV=production` only after sandbox exit criteria pass

## Main API routes

- `GET /api/dashboard`
- `POST /api/discovery/run`
- `POST /api/drafts/:draftId/approve`
- `POST /api/drafts/:draftId/reject`
- `POST /api/drafts/:draftId/publish`
- `POST /api/system/mode/approval`
- `POST /api/system/kill-switch`
- `POST /api/system/resume`
- `POST /api/worker/tick`

## Schema

The normalized production schema and indexes from the rollout plan live in:

- [supabase/schema.sql](C:/Users/SL/OneDrive/Desktop/Agents/Ashflow%20Eccommerce%20Autonomus/supabase/schema.sql)
