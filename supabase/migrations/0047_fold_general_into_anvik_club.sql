-- ═══════════════════════════════════════════════════════════════════════
-- 0047 — "General" folds into anvik.club
--
-- General was never chosen by anyone. `ensureProjectId` invents it when a
-- headless write needs somewhere to land and no project exists yet — quick
-- capture, mail conversion, a money import. Two rows ended up in it that way:
-- T-103 and a scribble titled "Hi". Then every picker offered it forever
-- after, which is what "don't auto select general as a project" was about.
-- The pickers were fixed; this removes the row they were offering.
--
-- Same shape as 0042, with one thing 0042 did not have to think about.
--
-- ── the array that is not a foreign key ────────────────────────────────
--
-- 0042 could repoint everything by walking pg_constraint, because every
-- reference to a project was a real FK column. Since 0045 that is no longer
-- true: `tasks.project_ids` holds project ids inside JSONB, where no
-- constraint can see them. A migration that only walked the FKs would delete
-- General, leave its id sitting inside project_ids, and produce a task whose
-- membership list points at a project that no longer exists — invisible until
-- a board filter quietly stops matching a card that is plainly on screen.
--
-- So the FK sweep stays (it is still the honest way to catch the ten scalar
-- columns, and the eleventh someone adds later) and the JSONB list is rebuilt
-- separately, per row, keeping the primary as element 0 and de-duplicating in
-- case a task was in General AND anvik.club already.
--
-- Re-runnable: nothing is named General afterwards, so a second apply matches
-- nothing.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $mig$
DECLARE
  keeper   text;
  folded   text;
  rec      record;
  entry    text;
  mapped   text;
  rebuilt  jsonb;
  moved    int;
  total    int := 0;
  strays   int;
BEGIN
  SELECT id INTO keeper FROM public.projects WHERE name = 'anvik.club';
  SELECT id INTO folded FROM public.projects WHERE lower(btrim(name)) = 'general';

  IF keeper IS NULL THEN
    RAISE EXCEPTION 'No project named anvik.club — refusing to guess where General should go';
  END IF;

  IF folded IS NULL THEN
    RAISE NOTICE 'No project named General; nothing to fold';
    RETURN;
  END IF;

  RAISE NOTICE 'folding % into %', folded, keeper;

  -- ── audit, before the rows stop pointing at it ───────────────────────
  INSERT INTO public.audit_trail (id, actor_id, actor_label, entity_type, entity_id, field_name, old_value, new_value, source)
  SELECT 'aud-0047-proj-' || t.id, NULL, 'Migration 0047', 'task', t.id, 'project_id', folded, keeper, 'portal'
    FROM public.tasks t WHERE t.project_id = folded;

  -- ── scalar FK columns, discovered rather than listed ─────────────────
  FOR rec IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.projects'::regclass
       AND array_length(c.conkey, 1) = 1
     ORDER BY 1, 2
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', rec.tbl, rec.col, rec.col)
      USING keeper, folded;
    GET DIAGNOSTICS moved = ROW_COUNT;
    total := total + moved;
    IF moved > 0 THEN
      RAISE NOTICE 'repointed % row(s) in %.%', moved, rec.tbl, rec.col;
    END IF;
  END LOOP;

  RAISE NOTICE 'total scalar references repointed: %', total;

  -- ── the JSONB membership list, rebuilt per row ───────────────────────
  -- Runs AFTER the sweep above, so `project_id` is already the keeper and can
  -- be trusted as element 0.
  moved := 0;
  FOR rec IN
    SELECT id, project_id, project_ids FROM public.tasks
     WHERE project_ids @> jsonb_build_array(folded)
  LOOP
    rebuilt := jsonb_build_array(rec.project_id);
    FOR entry IN SELECT jsonb_array_elements_text(rec.project_ids)
    LOOP
      mapped := CASE WHEN entry = folded THEN keeper ELSE entry END;
      IF NOT (rebuilt @> jsonb_build_array(mapped)) THEN
        rebuilt := rebuilt || jsonb_build_array(mapped);
      END IF;
    END LOOP;
    UPDATE public.tasks SET project_ids = rebuilt WHERE id = rec.id;
    moved := moved + 1;
  END LOOP;
  RAISE NOTICE 'rebuilt project_ids on % task(s)', moved;

  -- ── and the project itself ───────────────────────────────────────────
  INSERT INTO public.audit_trail (id, actor_id, actor_label, entity_type, entity_id, field_name, old_value, new_value, source)
  SELECT 'aud-0047-del-' || p.id, NULL, 'Migration 0047', 'project', p.id, 'deleted', p.name, NULL, 'portal'
    FROM public.projects p WHERE p.id = folded;

  DELETE FROM public.projects WHERE id = folded;

  -- ── refuse to half-apply ─────────────────────────────────────────────
  SELECT count(*) INTO strays FROM public.projects WHERE lower(btrim(name)) = 'general';
  IF strays > 0 THEN
    RAISE EXCEPTION 'General survived the fold';
  END IF;

  -- The failure this migration exists to avoid: an id left inside a JSONB
  -- list, pointing at a project that is gone.
  SELECT count(*) INTO strays
    FROM public.tasks t, jsonb_array_elements_text(t.project_ids) v
   WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v);
  IF strays > 0 THEN
    RAISE EXCEPTION '% project_ids entr(y/ies) point at a project that no longer exists', strays;
  END IF;

  SELECT count(*) INTO strays
    FROM public.tasks WHERE NOT (project_ids @> jsonb_build_array(project_id));
  IF strays > 0 THEN
    RAISE EXCEPTION '% task(s) no longer lead their own project list', strays;
  END IF;

  RAISE NOTICE 'done — General folded into anvik.club';
END
$mig$;

COMMIT;
