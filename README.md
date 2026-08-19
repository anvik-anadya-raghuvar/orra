# Anvik Ops

Internal operations portal for exactly two people — Anadya and Raghuvar — running a startup across India and Italy. Replaces Notion, Slack, Trello, and a notes app. See [IMPLEMENTATION-PLAN-v2.md](IMPLEMENTATION-PLAN-v2.md) for the full spec and [CLAUDE.md](CLAUDE.md) for standing rules.

## Stack

Vite · React 18 · TypeScript · Tailwind (+ ported prototype design system) · Framer Motion · Supabase (Postgres/Auth/Storage/Realtime) · Vercel. ₹0 recurring.

## Run it

```bash
npm install
npm run dev
```

With no `.env`, the app runs on the **local mock adapter** (localStorage-persisted, seeded, cross-tab realtime via BroadcastChannel). Every screen works fully offline.

## Connect the real backend

1. Create a Supabase project (free tier).
2. In the SQL editor, run every file in `supabase/migrations/` in numeric order, currently `0001_init.sql` through `0026_multi_google_personal_orders.sql`.
3. Auth is **email + password** (no Google OAuth). In Authentication → Users, create the two
   member accounts `anvik.anadya@gmail.com` and `raghuvar.anvik@gmail.com` with temp passwords,
   and disable public signups. Each member changes their password from the in-app account menu.
   (In local mock mode the temp passwords are `Anadya@2026` / `Raghuvar@2026`.)
4. Copy `.env.example` → `.env`, fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Restart dev / rebuild. The data adapter switches automatically; the sign-in gate starts checking real Supabase credentials against the allowlist trigger.

## Google setup (Gmail, Calendar, Drive)

All three connectors and every Google address run off **one** OAuth **client id**. There is no client secret anywhere in
this codebase, so none can leak from it, and access tokens live in browser memory for their hour —
never in Postgres, never in localStorage. What the database stores is only *which scopes were
granted* and account/sync metadata (`integration_grants`), so the Connections screen can be honest.
This does not require a paid API, subscription, server, or billing upgrade.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project, e.g. `anvik-ops`.
2. **APIs & Services → Library** → enable **Gmail API**, **Google Calendar API**, **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → **External** → app name + support email →
   **Audience → Test users**: add every Google address that will be connected.
   Leave it in **Testing**. Testing supports up to 100 Test users, but Google may require each
   address to consent again every seven days; the app exposes Reconnect on every account row.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Under
   **Authorised JavaScript origins** add both:
   ```
   https://anvik-ops.vercel.app
   http://localhost:5180
   ```
   No redirect URIs — the token flow doesn't use them.
5. Copy the client id (`….apps.googleusercontent.com`) into `.env` as `VITE_GOOGLE_CLIENT_ID`,
   and add the same variable in Vercel → Settings → Environment Variables. Restart dev / redeploy.
6. Apply `0026_multi_google_personal_orders.sql` before deploying this client. In the app, open
   **Admin → Connections → Add Google account** once per address. The chooser requests Gmail,
   Calendar, Drive, and identity together. Reconnect the legacy account once after migration.

What each one then does:

| Connector | After connecting | Scope |
| --- | --- | --- |
| Gmail | Latest 20 inbox messages per account sync into Notebook → Mail. A bounded 30-day first scan detects physical purchases and travel bookings for Life → Personal orders review | `gmail.readonly` |
| Calendar | Every account's primary calendar appears on the schedule with an account label; cancellation cleanup stays scoped to its source account | `calendar.events` |
| Drive | Notebook → Documents → **+ Document** searches every live Drive in parallel, labels results by account, and attaches only a reference | `drive.readonly` |

The first sync scans only commerce/travel candidates, fetches full content transiently, and stores
only structured detection evidence—never raw bodies, HTML, attachments, or tokens. Every detection
must be confirmed in **Life → Life admin → Personal orders**. Subscriptions, recurring charges,
Money, and the existing Subscriptions area are deliberately untouched.

**The honest limit:** this syncs immediately after connection and every 15 minutes while the portal
is open and that account's in-memory token is live. Timers never open OAuth. True background sync
(mail arriving while you're asleep) would need a refresh token held server-side—a different
security posture and a separate build. Account-prefixed external ids make re-sync idempotent even
when two accounts return the same Gmail, Calendar, or Drive id.

## YouTube setup (song of the day) — optional

Different credential from the one above: an **API key**, not an OAuth client. It reads public
search data and touches nobody's account, which is why there's no consent dialog.

1. Same Cloud project → **APIs & Services → Library** → enable **YouTube Data API v3**.
2. **Credentials → Create credentials → API key**.
3. **Restrict it before use** — this key ships inside the JS bundle:
   - **Application restrictions → Websites**: `https://anvik-ops.vercel.app/*` and `http://localhost:5180/*`
   - **API restrictions → Restrict key**: YouTube Data API v3 only
4. Set it as `VITE_YOUTUBE_API_KEY` in `.env` and in Vercel.

With the key set, picking a song by title and artist alone resolves to the real video — artwork on
the tile and a direct Play link. Without it, Play falls back to a YouTube search page, which is
what happens today. One lookup costs 100 of the 10,000 free daily quota units, and only runs when
you save a pick with no URL, so a day of normal use is roughly 1% of the allowance.

## Deploy (Vercel)

- Import the repo in Vercel — it auto-detects Vite (`npm run build`, output `dist`).
- `vercel.json` carries the SPA rewrite so client-side routes (`/work`, `/task/:id`, …) don't 404 on refresh.
- Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_GOOGLE_CLIENT_ID` as Vercel project environment variables (same values as `.env`).
- GitHub secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` power `.github/workflows/keepalive.yml` (3-day cron so the free Supabase project never pauses).
- Add `SUPABASE_SERVICE_ROLE_KEY` as a GitHub Actions secret for `.github/workflows/pulse.yml`. It is used only by the server-side news job; never add it to `.env`, Vercel, or any `VITE_` variable.

## Tests

```bash
npm test
```

Vitest covers the §6 correctness gates plus Google token/account isolation, account reactivation,
MIME decoding without attachments, account-specific links and composite ids, Drive partial failure,
calendar cancellation boundaries, Gmail history recovery, and Personal Orders review/lifecycle rules.

## Layout

- `src/data/` — swappable adapter boundary (`mockAdapter` / `supabaseAdapter`), central store (every mutation auto-appends to the audit trail), seed data.
- `src/lib/` — pure engines: `exportTask` (deterministic Claude handoff, spec §5), `ranking`, `warmth`, `dates`.
- `src/screens/` — one directory per routed screen.
- `supabase/migrations/` — full schema + RLS + allowlist trigger + append-only trail + storage policies.
