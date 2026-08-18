# Status: draft, not implemented, not deployed

This folder is the output of a design pass for multi-account sync (multiple
Google accounts, Titan Mail / IMAP, multiple YouTube accounts per profile).
Nothing in it has run against the real database and nothing in it is wired
into the app. Reviewed 2026-08-18 and held back for three concrete reasons:

1. **`GOOGLE_CLIENT_SECRET` in `proposed-edge-functions/accounts/google-connect.ts`.**
   Every other integration in this codebase (`src/lib/google.ts`,
   `src/lib/youtube.ts`) deliberately uses only public credentials — a client
   ID or an API key restricted by referrer — so nothing that can leak, leaks.
   A refresh-token flow needs a real secret, held server-side. That's a
   legitimate design for background sync; it is also a different security
   posture than everything else here, and should be a deliberate choice, not
   an inherited default.

2. **`encryption_key TEXT NOT NULL DEFAULT 'default'`** in
   `proposed-migration.sql.txt` (`account_credentials_vault`). That default
   is a placeholder, not a key — IMAP passwords and OAuth refresh tokens must
   never sit behind it. Any real version of this needs a generated key held
   in Supabase's Edge Function secrets (`ENCRYPTION_KEY_BASE64`, referenced
   in `proposed-edge-functions/README.md`), never a column default.

3. **It's a real subsystem, not an incremental change**: two new tables, a
   RESTRICTIVE RLS policy gating a credentials vault, three edge functions
   (~965 lines), and a cron for IMAP polling. That's infrastructure that
   needs its own deploy step and its own verification — it shouldn't land
   silently inside an unrelated commit.

None of this blocks what's live today. Gmail, Calendar and Drive already
work per-profile through the browser OAuth flow in `src/lib/google.ts` — one
Google account per person, which is what's connected right now. This draft
is what *multiple* accounts per person would take, for when that's actually
wanted.
