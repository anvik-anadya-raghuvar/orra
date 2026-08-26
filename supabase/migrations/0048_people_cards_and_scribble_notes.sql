-- Business cards, contact details, social links, and notes that behave like a
-- scribble — all on `people`.
--
-- Four things arrive together because they are one act: you meet somebody, you
-- photograph the card they hand you, and everything else follows from it.
--
-- 1. CONTACT COLUMNS. `people` had name, role and a time zone, and nowhere at
--    all to put an email address or a phone number — the two things a business
--    card exists to carry. Scanning a card with nowhere to put the result
--    would be theatre, so the columns come first. `company` is separate from
--    `role` because a card states both and they change independently: people
--    move companies and keep their title, or get promoted and keep their desk.
--
-- 2. CARDS. The card images themselves, front and back, kept rather than
--    discarded after the scan. OCR is imperfect and always will be; the
--    photograph is the source of truth you go back to when a digit looks
--    wrong. Stored as JSONB on the row for the same reason note images are
--    (migration 0021): a card has no independent life, nothing joins to it,
--    nothing queries across cards, and it dies with the person. Each entry is
--    src/types.ts `PersonCard` — an AttachedImage plus which side it is:
--
--      [{ id, side, filename, mime, width, height, bytes, data_url,
--         scanned_text, created_at }]
--
--    `scanned_text` is the raw OCR output, kept beside the image it came from.
--    It costs nothing, it makes the scan re-parseable without re-running the
--    engine, and it is what search can look through later.
--
-- 3. SOCIAL LINKS. Free-form {id, label, url} rows, not columns and not an
--    enum — the same reason tags are free-form (principle 8). Fixing the list
--    to linkedin/twitter/instagram guarantees being wrong the first time
--    somebody's card shows a platform nobody thought of.
--
-- 4. NOTE IMAGES + a bigger notes cap. `people.notes` becomes a scribble: text
--    with images pasted into the flow of it, exactly like `notes.body`. The
--    text column already exists and keeps carrying the words plus the
--    `{{anvik-image:ID}}` placement markers (src/ui/inlineImages.ts); the
--    bytes go in `note_images`, matching `notes.images` field for field. Its
--    10,000-character cap from migration 0030 is raised to the 100,000 that
--    `notes.body` gets, since it is now the same kind of surface.
--
-- Every cap below is the server-side half of the security gate: the client
-- refuses long before these, and these are what make it true when the client
-- is not the one writing. Safe to re-run.

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS email        TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone        TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS company      TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cards        JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS note_images  JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  -- Contact fields: generous, but bounded.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_contact_bounded') THEN
    ALTER TABLE public.people
      ADD CONSTRAINT people_contact_bounded CHECK (
        char_length(email) <= 320       -- RFC 5321's maximum path length
        AND char_length(phone) <= 60    -- room for '+39 02 1234 5678 ext. 12'
        AND char_length(company) <= 200
      );
  END IF;

  -- At most 12 links, and 16 KB of JSON — a URL is text, so this is roomy.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_social_links_bounded') THEN
    ALTER TABLE public.people
      ADD CONSTRAINT people_social_links_bounded CHECK (
        jsonb_typeof(social_links) = 'array'
        AND jsonb_array_length(social_links) <= 12
        AND pg_column_size(social_links) <= 16 * 1024
      );
  END IF;

  -- Four cards: a front and a back, twice, which covers somebody handing you a
  -- new card after they change jobs. 4 MB of JSON is those four at the
  -- compressor's own 300 KB ceiling with generous slack for the OCR text.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_cards_bounded') THEN
    ALTER TABLE public.people
      ADD CONSTRAINT people_cards_bounded CHECK (
        jsonb_typeof(cards) = 'array'
        AND jsonb_array_length(cards) <= 4
        AND pg_column_size(cards) <= 4 * 1024 * 1024
      );
  END IF;

  -- Deliberately identical to notes_images_bounded in migration 0021: it is
  -- the same surface, so it gets the same ceiling.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_note_images_bounded') THEN
    ALTER TABLE public.people
      ADD CONSTRAINT people_note_images_bounded CHECK (
        jsonb_typeof(note_images) = 'array'
        AND jsonb_array_length(note_images) <= 12
        AND pg_column_size(note_images) <= 8 * 1024 * 1024
      );
  END IF;
END $$;

-- Raise the notes cap set by migration 0030 from 10,000 to the 100,000 that
-- notes.body carries. Dropped and re-added rather than edited in place, since
-- a CHECK constraint has no ALTER. `cap_people_notes` is the name 0030's sweep
-- builds ('cap_' || table || '_' || column), and the NULL-tolerant shape below
-- is that sweep's too — kept identical so a re-run of 0030 and a re-run of
-- this land on the same constraint rather than fighting over it.
ALTER TABLE public.people DROP CONSTRAINT IF EXISTS cap_people_notes;
ALTER TABLE public.people
  ADD CONSTRAINT cap_people_notes CHECK (notes IS NULL OR char_length(notes) <= 100000);
