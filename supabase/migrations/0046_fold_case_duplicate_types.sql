-- ═══════════════════════════════════════════════════════════════════════
-- 0046 — one spelling per task type
--
-- 0042 set the folded pre-launch task's type to the literal 'pre launch',
-- taken straight from the sentence asking for it. Production already had a
-- task typed 'Pre Launch'. Nothing rejected the second spelling, because task
-- type has been free text since 0035 and free text is the point.
--
-- The result is invisible until you look for it: `typeLabel` in
-- screens/work/common.tsx title-cases for display, so BOTH render as
-- "Pre Launch" — two identical chips in the board's type filter, each
-- matching a different task, with no way to tell which is which. A filter
-- that silently splits one category in half is worse than no filter.
--
-- Rather than patch the one pair, this collapses every case-duplicate type
-- to a single spelling, because the same trap is set for every type either
-- of them ever types twice. The surviving spelling is the one on the OLDEST
-- task carrying it: the established vocabulary wins, and a later variant is
-- treated as the typo it almost always is.
--
-- On this apply that kept 'pre launch' (lowercase) and rewrote 'Pre Launch',
-- because the older task is T-101 (22 Aug) — the very row 0042 retyped — and
-- T-108 (26 Aug) came later. So the stored value is the odd one out against
-- their otherwise Title Case vocabulary (Management, Orra, Otto, Research).
-- Deliberately left alone rather than special-cased: `typeLabel` in
-- screens/work/common.tsx title-cases every type for display, so both spellings
-- always rendered "Pre Launch" and the board is now correct either way. The
-- defect was two chips, not which chip won.
--
-- `types` moves with `type`, keeping the primary as element 0 of its own
-- list, which is the invariant 0045 refuses to half-apply on.
--
-- Re-runnable: once folded there are no case duplicates left, so a second
-- apply matches nothing.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $mig$
DECLARE
  rec     record;
  moved   int;
  total   int := 0;
  strays  int;
BEGIN
  FOR rec IN
    -- One row per case-insensitive type that has more than one spelling,
    -- carrying the spelling to keep.
    SELECT lower(btrim(type)) AS folded,
           (array_agg(type ORDER BY created_at, id))[1] AS keep
      FROM public.tasks
     WHERE coalesce(btrim(type), '') <> ''
     GROUP BY lower(btrim(type))
    HAVING count(DISTINCT type) > 1
  LOOP
    UPDATE public.tasks
       SET type = rec.keep,
           types = jsonb_build_array(rec.keep)
                   || coalesce((
                        SELECT jsonb_agg(v)
                          FROM jsonb_array_elements_text(types) AS v
                         WHERE lower(btrim(v)) <> rec.folded
                      ), '[]'::jsonb)
     WHERE lower(btrim(type)) = rec.folded
       AND type <> rec.keep;
    GET DIAGNOSTICS moved = ROW_COUNT;
    total := total + moved;
    RAISE NOTICE 'type "%": % task(s) folded onto "%"', rec.folded, moved, rec.keep;
  END LOOP;

  RAISE NOTICE 'total tasks retyped: %', total;

  -- ── refuse to half-apply ─────────────────────────────────────────────
  SELECT count(*) INTO strays FROM (
    SELECT 1 FROM public.tasks
     WHERE coalesce(btrim(type), '') <> ''
     GROUP BY lower(btrim(type))
    HAVING count(DISTINCT type) > 1
  ) s;

  IF strays > 0 THEN
    RAISE EXCEPTION 'Fold incomplete: % type(s) still have more than one spelling', strays;
  END IF;

  -- The primary must still lead its own list, or 0045's invariant is broken.
  SELECT count(*) INTO strays
    FROM public.tasks
   WHERE coalesce(btrim(type), '') <> ''
     AND coalesce(types->>0, '') <> type;

  IF strays > 0 THEN
    RAISE EXCEPTION '% task(s) no longer lead their own types list', strays;
  END IF;
END
$mig$;

COMMIT;
