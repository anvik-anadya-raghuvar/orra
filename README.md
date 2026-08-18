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
2. In the SQL editor, run `supabase/migrations/0001_init.sql`, then `0002_day_plan.sql`, in that order.
3. Auth is **email + password** (no Google OAuth). In Authentication → Users, create the two
   member accounts `anvik.anadya@gmail.com` and `raghuvar.anvik@gmail.com` with temp passwords,
   and disable public signups. Each member changes their password from the in-app account menu.
   (In local mock mode the temp passwords are `Anadya@2026` / `Raghuvar@2026`.)
4. Copy `.env.example` → `.env`, fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Restart dev / rebuild. The data adapter switches automatically; the sign-in gate starts checking real Supabase credentials against the allowlist trigger.

## Deploy (Vercel)

- Import the repo in Vercel — it auto-detects Vite (`npm run build`, output `dist`).
- `vercel.json` carries the SPA rewrite so client-side routes (`/work`, `/task/:id`, …) don't 404 on refresh.
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel project environment variables (same values as `.env`).
- GitHub secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` power `.github/workflows/keepalive.yml` (3-day cron so the free Supabase project never pauses).

## Tests

```bash
npm test
```

Vitest covers the §6 correctness gates: byte-identical exports, contiguous pin numbering after deletion, ranking reacting to `ranking_weights` without redeploy, personal/business separation.

## Layout

- `src/data/` — swappable adapter boundary (`mockAdapter` / `supabaseAdapter`), central store (every mutation auto-appends to the audit trail), seed data.
- `src/lib/` — pure engines: `exportTask` (deterministic Claude handoff, spec §5), `ranking`, `warmth`, `dates`.
- `src/screens/` — one directory per routed screen.
- `supabase/migrations/` — full schema + RLS + allowlist trigger + append-only trail + storage policies.
