# WhaleScope Dashboard

Next.js App Router dashboard for the WhaleScope Google Sheets backend. This app is intended to be deployed from `apps/dashboard` on Vercel and to read Google Sheets only on the server side.

## Install

From the repository root, install the workspace dependencies once:

```bash
npm install
```

If you are working only inside this app directory, install there instead:

```bash
cd apps/dashboard
npm install
```

## Environment

Create `apps/dashboard/.env.local` from the example file before running the app:

```bash
cp .env.example .env.local
```

Keep the following values server-only:

- `GOOGLE_SHEET_ID`
- `GOOGLE_CREDENTIALS_JSON`
- `DASHBOARD_PASSWORD`
- `RENDER_PIPELINE_WEBHOOK_URL`
- `RENDER_PIPELINE_WEBHOOK_SECRET`

Only non-secret display values belong in `NEXT_PUBLIC_` variables.

## Local Development

From the repository root, use the workspace wrapper commands:

```bash
npm run dashboard:dev
npm run dashboard:build
```

If you are already inside `apps/dashboard`, the equivalent local commands are:

```bash
npm run dev
npm run build
```

## Vercel Deployment

Set the Vercel project Root Directory to `apps/dashboard`.

Do not expose server-only secrets to the browser bundle. Keep Google credentials, webhook secrets, and dashboard passwords in server-only environment variables.
