# sesh-web Notifications + Google Calendar Deployment Notes

This document captures the production fixes and verification steps for the two integrations that broke during redeploys:

- **Web push / PWA session alerts**
- **Google Calendar sync**

Use this whenever `sesh-web` is rebuilt, recreated, migrated, or its env/config is changed.

## Deployment shape

Live deployment currently uses:

- repo: `/home/ivan/projects/sesh-web`
- container: `sesh-web`
- local app URL: `http://127.0.0.1:3033`
- public URL: `https://sesh.liyifan.us`
- compose file: `docker-compose.yml`
- env file loaded by Compose: `.env.local`
- live DB mount: `/mnt/nas/docker/sesh-web/data:/app/data`
- live SQLite DB: `/mnt/nas/docker/sesh-web/data/sesh.db`

## 1) Web push / notification fixes

### Root cause we hit

Push broke because the live deployment lost these env vars from `.env.local`:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

When those were missing:

- authenticated `GET /api/push/vapid` returned `{"publicKey":""}`
- browser push subscription registration could not work correctly
- previously registered subscriptions failed after key rotation with `VapidPkHashMismatch`

### Relevant code paths

- `src/app/api/push/vapid/route.ts`
  - returns `process.env.VAPID_PUBLIC_KEY || ''`
- `src/lib/push.ts`
  - requires all 3 VAPID env vars before sending notifications
- `src/app/api/push/subscribe/route.ts`
  - stores browser subscriptions in `push_subscriptions`

### Fix that restored push

1. Restore the VAPID env vars in `.env.local`
2. Rebuild/recreate `sesh-web`
3. Verify the live app returns a non-empty public key
4. If keys changed, clear stale browser subscriptions from the DB
5. Re-enable notifications in the client/PWA so devices subscribe again

### Important consequence of VAPID rotation

If new VAPID keys are generated, **old browser subscriptions become invalid**.
That is expected. Existing rows in `push_subscriptions` may fail with `VapidPkHashMismatch` and should be removed.

Users/devices must then subscribe again from the UI.

### Push verification checklist

After deploy, verify:

```bash
cd /home/ivan/projects/sesh-web
curl -sS http://127.0.0.1:3033/api/push/vapid
```

Expected:

- response contains a **non-empty** `publicKey`

Check the DB subscription count if needed:

```bash
python3 - <<'PY'
import sqlite3
conn = sqlite3.connect('/mnt/nas/docker/sesh-web/data/sesh.db')
count = conn.execute('select count(*) from push_subscriptions').fetchone()[0]
print({'push_subscriptions_count': count})
PY
```

If rotated keys caused failures and you need to clear old subscriptions:

```bash
python3 - <<'PY'
import sqlite3
conn = sqlite3.connect('/mnt/nas/docker/sesh-web/data/sesh.db')
conn.execute('delete from push_subscriptions')
conn.commit()
print('cleared push_subscriptions')
PY
```

Then re-enable notifications in the app/PWA.

## 2) Google Calendar sync fixes

### Root causes we hit

Calendar sync broke for **multiple separate reasons** across the recovery work:

1. **Wrong OAuth client type** had been configured at one point
   - an old client was a TV / Limited Input client, which caused `redirect_uri_mismatch`
2. `/api/auth/google` needed to be evaluated at runtime
   - without `export const dynamic = 'force-dynamic'`, stale build output could keep redirecting with an old client ID
3. OAuth scope set was too narrow
   - token with only `calendar.events` could not list/create the dedicated `sesh` calendar
4. Later, live redeploy lost Google env vars from `.env.local`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
5. Stored access token expired and could not refresh until the env vars were restored

### Relevant code paths

- `src/app/api/auth/google/route.ts`
  - must stay `dynamic = 'force-dynamic'`
  - builds redirect URI from `NEXTAUTH_URL`
  - requests these scopes:
    - `https://www.googleapis.com/auth/calendar.events`
    - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
    - `https://www.googleapis.com/auth/calendar.calendars`
- `src/app/api/auth/google/status/route.ts`
  - reports `connected`, `accessTokenExpired`, and `syncReady`
- `src/lib/google-calendar.ts`
  - refreshes access tokens using `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
  - finds or creates the `sesh` calendar
  - skips rest sessions (`type === 'break'`) with `skipped: 'rest_session'`
- `src/app/api/calendar/sync-manual/route.ts`
  - retries unsynced sessions

### Fix that restored calendar sync

1. Restore `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`
2. Rebuild/recreate `sesh-web`
3. Log into the app and check `/api/auth/google/status`
4. If status shows expired but still connected, run manual sync retry
5. Confirm unsynced sessions drop to zero and status becomes `syncReady: true`

### Expected auth / redirect configuration

The Google OAuth redirect URI must match exactly:

```text
https://sesh.liyifan.us/api/auth/google/callback
```

The live app depends on:

- `NEXTAUTH_URL=https://sesh.liyifan.us`
- a valid **Web application** Google OAuth client
- matching `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

### Known behavior to preserve

- Calendar sync happens on **session completion/save**, not timer start
- Rest sessions are intentionally **not synced**
  - `syncSessionToGoogleCalendar()` returns `skipped: 'rest_session'` for `type === 'break'`
- The app syncs to a dedicated Google calendar named `sesh`
- If duplicate `sesh` calendars exist in Google, the cached `calendar_id` in `google_oauth` determines which one is used

### Calendar verification checklist

#### A. Confirm env-dependent route behavior

```bash
curl -sS -I http://127.0.0.1:3033/api/auth/google
```

You should not see behavior implying a stale old client after rebuild.

#### B. Log into the app and check auth status

Use app credentials from `.env.local` (`APP_AUTH_*` or legacy `BASIC_AUTH_*`) and inspect:

```bash
curl -sS http://127.0.0.1:3033/api/auth/google/status
```

Unauthenticated calls should return `401`; authenticated calls should show JSON like:

```json
{"connected":true,"accessTokenExpired":false,"syncReady":true}
```

#### C. Retry unsynced sessions if needed

```bash
curl -sS -X POST http://127.0.0.1:3033/api/calendar/sync-manual \
  -H 'Content-Type: application/json' \
  --data '{"limit":10}'
```

Expected shape:

```json
{
  "ok": true,
  "results": [...],
  "syncedCount": 1,
  "failedCount": 0
}
```

#### D. Check DB state directly

```bash
python3 - <<'PY'
import sqlite3
conn = sqlite3.connect('/mnt/nas/docker/sesh-web/data/sesh.db')
unsynced = conn.execute('select count(*) from sessions where is_synced = 0').fetchone()[0]
row = conn.execute('select length(access_token), length(refresh_token), expires_at from google_oauth where id = 1').fetchone()
print({
  'unsynced_sessions': unsynced,
  'access_token_len': row[0] if row else None,
  'refresh_token_len': row[1] if row else None,
  'expires_at': row[2] if row else None,
})
PY
```

Healthy result should show:

- `unsynced_sessions: 0` or decreasing after retry
- non-zero access/refresh token lengths

## Standard redeploy workflow for these integrations

From `/home/ivan/projects/sesh-web`:

```bash
docker compose up -d --build --force-recreate sesh-web
```

Then verify in this order:

1. container is up
2. app responds on `127.0.0.1:3033`
3. `GET /api/push/vapid` returns a non-empty key
4. authenticated `GET /api/auth/google/status` shows `connected/syncReady`
5. DB has expected token rows and reasonable unsynced session count
6. if needed, `POST /api/calendar/sync-manual` to backfill pending sessions
7. if VAPID keys changed, clear stale push subscriptions and re-subscribe devices

## Quick incident symptoms → likely cause

### Push

- `/api/push/vapid` returns `{"publicKey":""}`
  - missing `VAPID_*` env vars
- notifications used to work but now fail after redeploy/key change
  - stale browser subscriptions; re-subscribe clients
- send path errors with `VapidPkHashMismatch`
  - old subscriptions still tied to previous keypair

### Calendar

- Google connect shows `redirect_uri_mismatch`
  - wrong OAuth client type or wrong redirect URI config
- `connected: true, accessTokenExpired: true, syncReady: false`
  - refresh token exists but access token is expired; verify `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- sync/manual sync says `not_connected`
  - no valid refresh path or no saved token
- manual sync fails creating calendar
  - OAuth token likely missing calendar list/create scopes

## Notes for future maintenance

- Treat `.env.local` as the source of truth for these runtime secrets in this deployment
- Do not assume a successful rebuild preserved env vars; verify both push and calendar explicitly after recreate
- The live DB is under `/mnt/nas/docker/sesh-web/data/sesh.db`, not the repo-local `data/` path
- If calendar sync looks broken but a refresh token exists, try authenticated manual sync once before forcing a reconnect
- If push keys were rotated, re-subscription is expected behavior, not necessarily a new bug
