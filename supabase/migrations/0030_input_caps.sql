-- Server-side input caps for the free-text columns that had none.
--
-- The security gate in CLAUDE.md asks for input caps enforced server-side, and
-- roughly a third of the writable columns had them: comments, messages, goals,
-- orders, the annotation note, the inline screenshot. The rest were bounded
-- only by whatever the form happened to allow, which is not a bound at all —
-- the anon key is in the browser bundle by design, so anything the client can
-- write, a script can write, and the only real limit is Postgres itself. On a
-- 500 MB free tier that is a availability problem long before it is a storage
-- bill (target: ₹0 recurring).
--
-- The limits are deliberately far above anything real. Measured against live
-- data before writing this, the largest values in the database were: a 142 KB
-- inline photo data URL, a 266-byte personalization document, a 231-byte note
-- transcript, and a 146-character acceptance criterion. Everything else was
-- under 100 bytes. Nothing here can refuse content a person would actually
-- type; they exist to stop a runaway loop or a hostile script, not to edit.
--
-- Two shapes:
--   `chars` — char_length on a TEXT column.
--   `bytes` — pg_column_size on JSONB, which is the honest measure for a
--             document (char_length is not even defined for it).
--
-- NULL always passes: several of these columns are optional, and a constraint
-- that rejected NULL would be a schema change wearing a cap's clothing.
--
-- Safe to re-run: each constraint is dropped before it is added.

DO $$
DECLARE
  spec TEXT[];
  tbl TEXT; col TEXT; kind TEXT; cap TEXT; cname TEXT;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    -- the wiki: a page body is the single largest thing a person can author
    ARRAY['pages',               'blocks',              'bytes', '1000000'],
    ARRAY['pages',               'title',               'chars', '300'],
    -- scribbles
    ARRAY['notes',               'body',                'chars', '100000'],
    ARRAY['notes',               'title',               'chars', '300'],
    ARRAY['notes',               'transcript',          'bytes', '200000'],
    ARRAY['notes',               'checklist',           'bytes', '100000'],
    -- work
    ARRAY['tasks',               'title',               'chars', '500'],
    ARRAY['tasks',               'acceptance_criteria', 'chars', '20000'],
    ARRAY['tasks',               'blocked_reason',      'chars', '2000'],
    ARRAY['subtasks',            'title',               'chars', '500'],
    ARRAY['decisions',           'question',            'chars', '2000'],
    ARRAY['decisions',           'recommendation',      'chars', '10000'],
    ARRAY['decisions',           'ruling_note',         'chars', '10000'],
    ARRAY['objectives',          'title',               'chars', '300'],
    ARRAY['key_results',         'title',               'chars', '300'],
    ARRAY['projects',            'name',                'chars', '120'],
    ARRAY['projects',            'description',         'chars', '2000'],
    ARRAY['sprints',             'name',                'chars', '120'],
    ARRAY['tags',                'name',                'chars', '60'],
    ARRAY['annotation_pins',     'label',               'chars', '200'],
    -- people
    ARRAY['people',              'name',                'chars', '200'],
    ARRAY['people',              'notes',               'chars', '10000'],
    ARRAY['people',              'next_action',         'chars', '500'],
    ARRAY['people_interactions', 'summary',             'chars', '5000'],
    -- the day
    ARRAY['daily_closeouts',     'shipped',             'chars', '5000'],
    ARRAY['daily_closeouts',     'stuck',               'chars', '5000'],
    ARRAY['daily_closeouts',     'tomorrow',            'chars', '5000'],
    ARRAY['active_blocks',       'custom_label',        'chars', '200'],
    ARRAY['active_blocks',       'custom_items',        'bytes', '50000'],
    -- personal
    ARRAY['life_admin',          'item',                'chars', '500'],
    ARRAY['fixed_dates',         'label',               'chars', '200'],
    ARRAY['courses',             'title',               'chars', '200'],
    ARRAY['course_items',        'title',               'chars', '300'],
    ARRAY['reading_queue',       'title',               'chars', '300'],
    ARRAY['reading_queue',       'author',              'chars', '200'],
    ARRAY['mood_items',          'url',                 'chars', '2000'],
    ARRAY['documents',           'title',               'chars', '300'],
    -- inbound mail: written by the sync, whose input we do not control
    ARRAY['mail_items',          'subject',             'chars', '1000'],
    ARRAY['mail_items',          'snippet',             'chars', '5000'],
    -- profile
    ARRAY['profiles',            'name',                'chars', '200'],
    ARRAY['profiles',            'status_text',         'chars', '300'],
    ARRAY['profiles',            'personalization',     'bytes', '20000'],
    -- attachments that may still carry an inline data URL. Same ceiling as
    -- screenshot_attachments (0022): imageCompress caps at ~300 KB binary,
    -- which is ~400 K base64 characters; 700 K leaves room for the header and
    -- for the 142 KB photo already in shared_daily.
    ARRAY['messages',            'attachment_url',      'chars', '700000'],
    ARRAY['shared_daily',        'photo_url',           'chars', '700000'],
    ARRAY['shared_daily',        'photo_caption',       'chars', '2000']
  ] LOOP
    tbl := spec[1]; col := spec[2]; kind := spec[3]; cap := spec[4];
    cname := 'cap_' || tbl || '_' || col;

    -- A column that does not exist on this database is skipped rather than
    -- failing the migration: the caps are a sweep across the whole schema, and
    -- one renamed column should not block the other forty-three.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = col
    ) THEN
      RAISE NOTICE 'skipping %.% — no such column', tbl, col;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', tbl, cname);
    IF kind = 'chars' THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR char_length(%I) <= %s)',
        tbl, cname, col, col, cap);
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR pg_column_size(%I) <= %s)',
        tbl, cname, col, col, cap);
    END IF;
  END LOOP;
END $$;
