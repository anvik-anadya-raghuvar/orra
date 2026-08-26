-- ═══════════════════════════════════════════════════════════════════════
-- 0041 — the test account follows the rename: test@anvik.ops → test@orra.ops
--
-- The app is ORRA now, and the seeded demo account was the last piece of
-- addressable state still carrying the old name. The two real members are
-- deliberately untouched: anvik.anadya@gmail.com and raghuvar.anvik@gmail.com
-- are real Gmail inboxes and the identity Supabase authenticates against —
-- renaming those would lock both people out of their own portal, and "Anvik"
-- is the company name anyway, not the app's.
--
-- The account id (00000000-0000-4000-8000-000000000001) does not change, so
-- every row that references the user by id — tasks, notes, audit trail — is
-- untouched by design. Only the columns that store the address as *text* need
-- rewriting, and information_schema says there are exactly seven of them:
-- profiles.email, allowlist.email, and account_email on day_events,
-- documents, integration_grants, mail_items and personal_orders.
--
-- Written to be re-runnable: every statement is scoped to the old address, so
-- a second apply matches nothing and changes nothing.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── auth schema ────────────────────────────────────────────────────────
-- The login identity itself. `email_change` is cleared alongside it so this
-- never looks like a half-finished email-change flow to GoTrue.
UPDATE auth.users
   SET email = 'test@orra.ops',
       email_change = '',
       email_change_token_new = '',
       email_change_token_current = ''
 WHERE email = 'test@anvik.ops';

-- The email provider's identity row carries its own copy of the address.
-- Leaving this behind is what makes a renamed account fail to sign in:
-- GoTrue matches the identity, not just auth.users. provider_id stays the
-- user's uuid (that is what 0004 seeded it as), so only the JSON moves.
UPDATE auth.identities
   SET identity_data = jsonb_set(identity_data, '{email}', '"test@orra.ops"')
 WHERE provider = 'email'
   AND identity_data->>'email' = 'test@anvik.ops';

-- ── public schema ──────────────────────────────────────────────────────
UPDATE public.profiles
   SET email = 'test@orra.ops'
 WHERE email = 'test@anvik.ops';

-- 0023_security_hardening.sql already removed the test account's allowlist
-- row, so this normally matches nothing. It stays because the alternative is
-- a migration that silently depends on 0023 having run first.
UPDATE public.allowlist
   SET email = 'test@orra.ops'
 WHERE email = 'test@anvik.ops';

-- Connected-account columns. Currently empty of the test address on
-- production — the demo mail was reattributed by 0034 — but these are the
-- columns that would carry it, and a rename that covers six of seven is a
-- rename that breaks later.
UPDATE public.day_events         SET account_email = 'test@orra.ops' WHERE account_email = 'test@anvik.ops';
UPDATE public.documents          SET account_email = 'test@orra.ops' WHERE account_email = 'test@anvik.ops';
UPDATE public.integration_grants SET account_email = 'test@orra.ops' WHERE account_email = 'test@anvik.ops';
UPDATE public.mail_items         SET account_email = 'test@orra.ops' WHERE account_email = 'test@anvik.ops';
UPDATE public.personal_orders    SET account_email = 'test@orra.ops' WHERE account_email = 'test@anvik.ops';

-- ── refuse to half-apply ───────────────────────────────────────────────
-- auth.users and auth.identities disagreeing is the failure mode that is
-- invisible until someone tries to sign in, so it fails the transaction here
-- instead of at a login prompt weeks from now.
DO $$
DECLARE
  stale_users int;
  stale_ids   int;
  renamed     int;
BEGIN
  SELECT count(*) INTO stale_users FROM auth.users      WHERE email = 'test@anvik.ops';
  SELECT count(*) INTO stale_ids   FROM auth.identities WHERE identity_data->>'email' = 'test@anvik.ops';
  SELECT count(*) INTO renamed     FROM auth.users      WHERE email = 'test@orra.ops';

  IF stale_users > 0 OR stale_ids > 0 THEN
    RAISE EXCEPTION
      'Rename incomplete: % auth.users and % auth.identities still on test@anvik.ops',
      stale_users, stale_ids;
  END IF;

  IF renamed <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one auth.users row on test@orra.ops, found %', renamed;
  END IF;
END $$;

COMMIT;
