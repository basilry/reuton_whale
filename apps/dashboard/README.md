# WhaleScope Dashboard

Next.js App Router dashboards for the WhaleScope Google Sheets backend. This package covers two routes:

- `/` for the user-facing insight home
- `/admin` for the operations/admin dashboard
- `/insights` as a legacy redirect to `/`

This app is the Vercel deployment target for the Product Engineer assignment and replaces Streamlit as the primary presentation surface.

The HTML references in `docs/demo_pic/admin_dashboard.html` and `docs/demo_pic/user_dashboard.html` were used as design inputs for the split.

UI chrome defaults to light theme when a visitor has no saved preference. The dashboard language skeleton currently supports `ko` and `en`, and the shared navbar / Telegram CTA chrome reads the `dashboard_lang` cookie through the new dictionary layer under `apps/dashboard/lib/i18n`.

## What It Shows

The dashboards are read-only. They do not collect blockchain data by themselves. They read the sheets populated by the Python workers and render:

- overview metrics from `transactions`, `signals`, `daily_brief`, `subscribers`, and `system_log`
- latest Korean daily brief
- recent whale transactions
- rule-based signal outputs
- compact news/context cards from `news_feed`, with a safe fallback to latest briefs/signals when the tab is empty
- latest pipeline/system log events
- Telegram listener health from `system_log` heartbeat rows, with latest `tg_whale_events` as a fallback, not from generic Sheets connectivity

## Runtime Boundary

| Part | Runtime | Responsibility |
|---|---|---|
| Dashboard UI | Vercel / Next.js | Render `/` user-facing view and `/admin` operations view |
| Data source | Google Sheets | MVP persistent store |
| Pipeline | Render Cron Job | Run `python -m src.pipeline.run_all` and write Sheets |
| Telegram bot | Render Worker | Handle user commands |
| Telegram listener | Render Worker | Listen to public whale alert channels |

Do not merge the Python workers into this Vercel app. Vercel should only serve the dashboards and server-side read APIs.

## Route Purpose

`/` is the user-facing view. It is meant for human-readable briefings, market mood, signal summaries, watchlist context, and Telegram onboarding. It should avoid raw worker logs and JSON-like operational details.

`/admin` is the operator-facing view. It is meant for checking pipeline health, Sheets-backed snapshots, and the latest operational state. The Telegram listener card is based on `system_log` rows where `run_type=telethon_listener`, and falls back to the latest `tg_whale_events` timestamp only when no listener heartbeat exists. It can show waiting, auth-required, attention-needed, or healthy states independently from Google Sheets connectivity.

`/insights` is retained only for compatibility and redirects to `/`.

## Requirements

- Node.js 20+
- npm
- Google Spreadsheet initialized by `python -m scripts.init_sheets`
- Google service account shared to the Spreadsheet
- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`

## Environment

The dashboard loads the repository root `.env` directly via `apps/dashboard/next.config.ts`. There is no copy step: put server secrets in `/02015_reuton_whale/.env` once and both the Python pipelines and this app read from the same file.

Layout:

| File | Purpose | Commit? |
|---|---|---|
| `/02015_reuton_whale/.env` | Server secrets (`GOOGLE_*`, `TELEGRAM_*`, API keys) | Never |
| `apps/dashboard/.env` | Public `NEXT_PUBLIC_*` defaults | Yes |
| `apps/dashboard/.env.local` | Per-developer overrides (usually empty) | Never |

Precedence (highest wins):

1. Shell `export` or Vercel dashboard env
2. `apps/dashboard/.env.local`
3. `apps/dashboard/.env`
4. `/02015_reuton_whale/.env` (loaded last by `next.config.ts`, only fills in missing keys)

Bootstrap a new checkout:

```bash
# From the repository root, fill in secrets:
cp .env.example .env
# Edit .env with your GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON, TELEGRAM_*.
```

Current required values:

| Variable | Required | Scope | Description |
|---|---:|---|---|
| `GOOGLE_SHEET_ID` | Yes | server-only | Spreadsheet ID, not the full URL |
| `GOOGLE_CREDENTIALS_JSON` | Yes | server-only | Full service account JSON as a single-line string |
| `NEXT_PUBLIC_APP_NAME` | No | public | Display-only app name |
| `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` | No* | public | Public Telegram channel handle without the leading `@`. Current WhaleScope public channel: `whalescope_alertz` (<https://t.me/whalescope_alertz>). Used by the user home CTA and the internal `/api/qr` endpoint to build the public channel link and QR image. `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` remains a one-release fallback only. *No* = not required for the app to boot, but the Telegram CTA will switch into an unavailable state (no outbound link, no QR) when unset. |
| `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` | No | public | Legacy fallback for older deployments. Prefer `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME`. |
| `DASHBOARD_PASSWORD` | Yes in production, no in local dev | server-only | Enables operator API auth when set. Production requests fail closed with `401 {"error":"missing-production-password"}` if it is missing. Use `Authorization: Bearer <password>` in production; `x-dashboard-password` stays for local/manual checks. The `/admin` page also exchanges this password for an httpOnly browser session cookie so protected APIs can be used without manually attaching headers. |

Reserved values for planned run-trigger extensions:

| Variable | Required Now | Scope | Description |
|---|---:|---|---|
| `RENDER_PIPELINE_WEBHOOK_URL` | No | server-only | Future manual pipeline trigger |
| `RENDER_PIPELINE_WEBHOOK_SECRET` | No | server-only | Future webhook signing secret |

Do not prefix Google credentials with `NEXT_PUBLIC_`. Do not run `source .env` or `source .env.local` for `GOOGLE_CREDENTIALS_JSON`; shell parsing can strip JSON quotes. `next.config.ts` parses the root `.env` itself and keeps the JSON payload intact.

## Local Development

Install dependencies once from the repository root:

```bash
npm install
```

Run the dashboard:

```bash
npm run dashboard:dev
```

The app defaults to `http://localhost:3000`. No pre-copy step runs — the root `.env` is loaded directly when Next.js evaluates `next.config.ts`. The former `scripts/sync-env.mjs` copy flow has been retired because `JSON.stringify`-based wrapping corrupted multi-line JSON payloads (notably `GOOGLE_CREDENTIALS_JSON`).

Equivalent commands from inside `apps/dashboard`:

```bash
npm run dev
npm run build
```

## Validation

Run these before deploying:

```bash
npm run dashboard:lint
npm run dashboard:typecheck
npm run dashboard:build
```

Optional API checks after starting the dev server:

```bash
curl -sS http://127.0.0.1:3000/api/dashboard
curl -sS "http://127.0.0.1:3000/api/transactions?limit=2"
curl -sS "http://127.0.0.1:3000/api/signals?limit=2"
curl -sS "http://127.0.0.1:3000/api/system-log?limit=2"
```

## API Routes

| Route | Description |
|---|---|
| `/api/dashboard` | Combined snapshot for the page |
| `/api/transactions?limit=20` | Recent transaction rows |
| `/api/signals?limit=20` | Recent signal rows |
| `/api/system-log?limit=25` | Recent system log rows |
| `/api/news?limit=4` | Compact user-home news/context payload, preferring `news_feed` rows |
| `/api/qr?data=...` | Internal SVG QR generator for the Telegram CTA |
| `/api/language` | Public cookie read/write endpoint for dashboard chrome language (`ko`, `en`) |
| `/api/admin/session` | Browser session login/logout for `/admin` |

All routes use the Node.js runtime and read Google Sheets on the server side.

The curated wallet registry prefers Sheets-backed rows from `curated_wallets`. If that tab is empty or unavailable, the dashboard falls back to the legacy `watched_addresses` tab. If both tabs are unavailable, the dashboard uses the in-repo seed unless `WHALESCOPE_CURATED_DISABLE_SEED=1` is set, in which case the user-home watchlist becomes intentionally empty. Watchlist toggles are written as append-only override rows so the latest value wins without needing an in-place sheet update.

The user-home news foundation follows the same pattern. `src/ingestion/news_rss.py` can append public RSS headlines into the optional `news_feed` tab, the public `/api/news` route reads those rows for the homepage, and `NewsWidget` now keeps data fetching on the server while a small client presenter handles the mobile `2개+펼치기` interaction in the right news rail. If `news_feed` is empty or unavailable, the widget degrades to brief/signal-derived context instead of throwing a hard empty state.

## Vercel Deployment

Create a Vercel project with these settings:

| Setting | Value |
|---|---|
| Root Directory | `apps/dashboard` |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output | Next.js default |

Register these environment variables in Vercel Project Settings:

- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` (set to `whalescope_alertz` to activate the Telegram CTA)
- `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` only if you still need the legacy fallback during migration
- `DASHBOARD_PASSWORD` (required in production; if missing, operator API requests return 401)

The `/admin` page uses the same `DASHBOARD_PASSWORD` value to mint a short-lived httpOnly cookie session. That keeps the operator browser authenticated across page loads and protected API calls without weakening the existing header-based API path.

Keep `GOOGLE_CREDENTIALS_JSON` as a server-only environment variable. The service account only needs read access for the dashboard, but the same account may have editor access because the Python pipeline writes to the same sheet.

## Troubleshooting

### Dashboard shows fallback data

Check that `GOOGLE_SHEET_ID` and `GOOGLE_CREDENTIALS_JSON` exist in `.env.local` or Vercel env. Also verify the service account email has access to the Spreadsheet.

For local development, these values may also live in the repository root `.env`. If you changed env values while `next dev` is running, restart the dev server.

### `GOOGLE_CREDENTIALS_JSON must contain valid service account JSON`

Use a single-line JSON string. If the private key contains escaped newlines, keep them as `\\n`; the app converts them before authentication.

### `missing-production-password`

This means the dashboard is deployed in production without `DASHBOARD_PASSWORD`. Add it in the Vercel environment for any production deployment that exposes the operator APIs.

### Dashboard is empty

The dashboard only reads Sheets. Run the backend first:

```bash
python -m scripts.init_sheets
python scripts/import_watched_addresses.py
python -m src.pipeline.run_all
```

Then refresh the dashboard.

### Telegram CTA is disabled

This is expected when neither `NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME` nor the legacy fallback `NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL` is set. The modal still renders explanatory copy, but the open/copy/QR actions remain unavailable until one of those public env values is configured.

### Vercel build succeeds but runtime API fails

Most runtime failures are env or permission issues. Check Vercel Runtime Logs for `/api/dashboard` and confirm the env values are set in the same Vercel environment that served the deployment.
