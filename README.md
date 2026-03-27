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

## Background Timer Auto-Completion

When a timer expires while no client tab is actively running, the server can auto-complete the session:

- **`DISCORD_WEBHOOK_URL`** — optional env var. When set, a Discord message is posted when a session is auto-completed in the background.
- **How it works** — the service worker periodically pings `GET /api/timer?background=1` every 30 seconds. If the server detects the timer has expired, it atomically saves the session and resets the timer.
- **Limitations** — background completion relies on the service worker staying alive, which is best-effort. Browsers may kill the worker after all tabs are closed, especially on mobile and Safari. Guaranteed all-tabs-closed completion would require a server-side scheduler or external ping service (e.g., cron job hitting the background endpoint).

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
