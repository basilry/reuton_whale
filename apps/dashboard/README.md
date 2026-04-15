# WhaleScope Dashboard

Next.js App Router dashboard for the WhaleScope Google Sheets backend. This app is the Vercel deployment target for the Product Engineer assignment and replaces Streamlit as the primary presentation surface.

## What It Shows

The dashboard is read-only. It does not collect blockchain data by itself. It reads the sheets populated by the Python workers and renders:

- overview metrics from `transactions`, `signals`, `daily_brief`, `subscribers`, and `system_log`
- latest Korean daily brief
- recent whale transactions
- rule-based signal outputs
- latest pipeline/system log events

## Runtime Boundary

| Part | Runtime | Responsibility |
|---|---|---|
| Dashboard UI | Vercel / Next.js | Render operational view and API route handlers |
| Data source | Google Sheets | MVP persistent store |
| Pipeline | Render Cron Job or Worker | Run `python -m src.main` and write Sheets |
| Telegram bot | Render Worker | Handle user commands |
| Telegram listener | Render Worker | Listen to public whale alert channels |

Do not merge the Python workers into this Vercel app. Vercel should only serve the dashboard and server-side read APIs.

## Requirements

- Node.js 20+
- npm
- Google Spreadsheet initialized by `python -m scripts.init_sheets`
- Google service account shared to the Spreadsheet
- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`

## Environment

Create `apps/dashboard/.env.local` from the example file before running the app if you want dashboard-specific local env values. For local convenience, the app also falls back to the repository root `.env` when `apps/dashboard/.env.local` is missing.

From the repository root:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

From inside `apps/dashboard`:

```bash
cp .env.example .env.local
```

Current required values:

| Variable | Required | Scope | Description |
|---|---:|---|---|
| `GOOGLE_SHEET_ID` | Yes | server-only | Spreadsheet ID, not the full URL |
| `GOOGLE_CREDENTIALS_JSON` | Yes | server-only | Full service account JSON as a single-line string |
| `NEXT_PUBLIC_APP_NAME` | No | public | Display-only app name |

Reserved values for planned auth/run-trigger extensions:

| Variable | Required Now | Scope | Description |
|---|---:|---|---|
| `DASHBOARD_PASSWORD` | No | server-only | Future dashboard access control |
| `RENDER_PIPELINE_WEBHOOK_URL` | No | server-only | Future manual pipeline trigger |
| `RENDER_PIPELINE_WEBHOOK_SECRET` | No | server-only | Future webhook signing secret |

Do not prefix Google credentials with `NEXT_PUBLIC_`. Do not run `source .env.local` or `source ../../.env` for `GOOGLE_CREDENTIALS_JSON`; shell parsing can strip JSON quotes. Next.js loads `.env.local`, and this app can read the repository root `.env` directly on the server side during local development.

## Local Development

Install dependencies once from the repository root:

```bash
npm install
```

Run the dashboard:

```bash
npm run dashboard:dev
```

The app defaults to `http://localhost:3000`.

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

All routes use the Node.js runtime and read Google Sheets on the server side.

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

Keep `GOOGLE_CREDENTIALS_JSON` as a server-only environment variable. The service account only needs read access for the dashboard, but the same account may have editor access because the Python pipeline writes to the same sheet.

## Troubleshooting

### Dashboard shows fallback data

Check that `GOOGLE_SHEET_ID` and `GOOGLE_CREDENTIALS_JSON` exist in `.env.local` or Vercel env. Also verify the service account email has access to the Spreadsheet.

For local development, these values may also live in the repository root `.env`. If you changed env values while `next dev` is running, restart the dev server.

### `GOOGLE_CREDENTIALS_JSON must contain valid service account JSON`

Use a single-line JSON string. If the private key contains escaped newlines, keep them as `\\n`; the app converts them before authentication.

### Dashboard is empty

The dashboard only reads Sheets. Run the backend first:

```bash
python -m scripts.init_sheets
python scripts/import_watched_addresses.py
python -m src.main
```

Then refresh the dashboard.

### Vercel build succeeds but runtime API fails

Most runtime failures are env or permission issues. Check Vercel Runtime Logs for `/api/dashboard` and confirm the env values are set in the same Vercel environment that served the deployment.
