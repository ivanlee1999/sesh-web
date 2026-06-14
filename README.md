This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## App Login Protection

`sesh-web` can be protected with a shared app login that uses a signed HTTP-only session cookie. This is a better fit for a PWA than browser Basic Auth: users sign in once inside the app, then the installed PWA stays gated until logout or session expiry.

### Required env vars

- `APP_AUTH_USERNAME` — shared login username
- `APP_AUTH_PASSWORD` — shared login password
- `NEXTAUTH_SECRET` — signing secret for the session cookie

Supported legacy fallback names:
- `BASIC_AUTH_USERNAME`
- `BASIC_AUTH_PASSWORD`

Optional escape hatch for local/dev only:
- `DISABLE_APP_AUTH=true` (also supports legacy `DISABLE_BASIC_AUTH=true`)

### Behavior

- Unauthenticated page visits are redirected to `/login`.
- Unauthenticated API requests return HTTP `401`.
- If auth is enabled but required credentials/signing secret are missing, the app fails closed with HTTP `503` instead of serving publicly.
- The installed PWA is forced through the network for page navigations so cached shells do not bypass login.
- Users can log out from the Settings tab.

### Running the production standalone build locally

For PWA verification, do **not** run `node .next/standalone/server.js` immediately after `next build` by itself. The standalone server needs the generated `public/` assets and `._next/static` copied into the standalone runtime tree, otherwise the PWA endpoints (`/manifest.json`, `/sw.js`, `/_next/static/*`) will 404 and installed PWAs may keep using an old shell.

Use:

```bash
npm run build:standalone
APP_AUTH_USERNAME=... APP_AUTH_PASSWORD=... NEXTAUTH_SECRET=... npm run start:standalone
```

The Dockerfile already performs these copies for containerized deployments.

## Background Timer Auto-Completion

When a timer expires while no client tab is actively running, the server can auto-complete the session:

- **`DISCORD_WEBHOOK_URL`** — optional env var. When set, a Discord message is posted when a session is auto-completed in the background.
- **How it works** — the service worker periodically pings `GET /api/timer?background=1` every 30 seconds. If the server detects the timer has expired, it atomically saves the session and resets the timer.
- **Limitations** — background completion relies on the service worker staying alive, which is best-effort. Browsers may kill the worker after all tabs are closed, especially on mobile and Safari. Guaranteed all-tabs-closed completion would require a server-side scheduler or external ping service (e.g., cron job hitting the background endpoint).

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Operations Notes

For production redeploys and incident recovery of push notifications / PWA alerts and Google Calendar sync, see:

- [`DEPLOYMENT-NOTIFICATIONS-CALENDAR.md`](./DEPLOYMENT-NOTIFICATIONS-CALENDAR.md)

It documents the env vars, runtime behavior, failure modes we hit in production, and the post-redeploy verification checklist.

## Testing

```bash
# Run all tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```

### Test Structure
Tests live in `__tests__/` directories next to the source files they test:

```
src/
├── lib/__tests__/
│   ├── categories.test.ts     # slugifyLabel, getCategoryMeta
│   └── local-store.test.ts    # localStorage ops, NaN coercion, session queue
├── app/api/__tests__/
│   ├── timer.test.ts          # toEpochMs, PUT coercion, notifications
│   ├── categories-api.test.ts # CRUD, rename migration, delete fallback
│   └── analytics.test.ts      # timezone boundaries, streaks, aggregation
├── components/__tests__/
│   └── ProgressRing.test.tsx   # rendering, tick marks, wedge, clock hand
├── hooks/__tests__/
│   └── useOnlineStatus.test.ts # online/offline events
└── context/__tests__/
    └── CategoriesContext.test.tsx # fetch, cache, CRUD operations
```

### Contributing
- Every new function must have unit tests
- Bug fixes must include a regression test
- Run `npm test` before committing
