# Deployment Guide

## 1. Heroku app layout

Use one Heroku app with:
- `web` dyno for the API + frontend
- `worker` dyno for queue processing

`Procfile` is already included:

```txt
web: npm run start
worker: npm run worker
```

## 2. Required config vars

Set these in Heroku:

```txt
NODE_ENV=production
APP_BASE_URL=https://<your-heroku-app>.herokuapp.com
SESSION_SECRET=<random-secret>
STORAGE_DRIVER=postgres
DATABASE_URL=<supabase pooled postgres connection string>

EBAY_ENV=sandbox
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_REDIRECT_URI=...
EBAY_SANDBOX_CLIENT_ID=...
EBAY_SANDBOX_CLIENT_SECRET=...
EBAY_SANDBOX_REDIRECT_URI=...

CJ_API_BASE_URL=https://developers.cjdropshipping.com/api2.0/v1
CJ_API_KEY=...
CJ_ACCESS_TOKEN=...

DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
AI_MONTHLY_CAP_USD=20
AI_DAILY_CAP_USD=0.65
```

## 3. Supabase / Postgres

1. Create a Supabase project
2. Use the pooled Postgres URL as `DATABASE_URL`
3. Apply [supabase/schema.sql](C:/Users/SL/OneDrive/Desktop/Agents/Ashflow%20Eccommerce%20Autonomus/supabase/schema.sql)

The runtime currently uses:
- snapshot state storage
- worker job table with `FOR UPDATE SKIP LOCKED`

The SQL file also includes the normalized tables and indexes planned for the next migration stage.

## 4. Sandbox-first rollout

Week 1:
- `EBAY_ENV=sandbox`
- run discovery against real CJ product data
- create and publish sandbox-only listings
- verify no duplicate jobs, no duplicate drafts, and no unresolved dead letters

Week 2:
- switch `EBAY_ENV=production`
- use `POST /api/system/mode/approval`
- keep listing publish approval manual

## 5. Kill switch

If production behavior is unsafe:

1. Press the dashboard kill switch or call:
   - `POST /api/system/kill-switch`
2. The system will:
   - pause automation
   - stop new publishes
   - stop new CJ pushes
   - queue quantity-zero and offer-withdraw rollback jobs

## 6. Validation checklist

Before production auto-publish:
- 7 full sandbox days completed
- no duplicate listings
- no duplicate CJ pushes
- stock sync error rate under 2%
- refund/cancellation rate below threshold
- margin calculations match real orders
