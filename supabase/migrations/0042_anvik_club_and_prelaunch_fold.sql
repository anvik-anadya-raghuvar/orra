-- ═══════════════════════════════════════════════════════════════════════
-- 0042 — the project is anvik.club, and "Pre Launch" stops being one
--
-- Three asks, one transaction, because they are the same move:
--
--   1. The project called "Anvik" is renamed "anvik.club".
--   2. Everything filed under "Pre Launch" moves into it.
--   3. Those tasks keep the distinction they actually had — not as a
--      project, but as their task type, which has been free text since
--      0035_free_project_and_type.sql. `pre launch` is a *kind* of work on
--      anvik.club, not a separate body of work, and modelling it as a
--      project split the one thing they are building in two.
--
-- "Reflect these changes for both ids" is why every match here is by NAME,
-- normalised and case-insensitive, never by id. `projects` rows are shared
-- (is_personal = false, no user_id column), but nothing stops the two of
-- them having each typed "Anvik" or "Pre launch" into a picker on their own
-- day and got two rows. Folding by name catches every such duplicate; a
-- migration written against one id would silently leave the other person's
-- copy standing.
--
-- The referencing columns are discovered from pg_constraint rather than
-- listed. Ten columns point at projects(id) today — objectives, tasks,
-- decisions, notes, mail_items, documents, people, ledger,
-- personal_goals.linked_project_id and subscriptions.project_id — and the
-- eleventh someone adds next month would be exactly the row this migration
-- would otherwise orphan. Only the task rows were asked for by name; the
-- rest have to move too or the DELETE at the end cannot run at all.
--
-- Re-runnable: a second apply finds nothing named "Anvik" or "Pre Launch",
-- finds the keeper already named "anvik.club", and changes nothing.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $mig$
DECLARE
  -- Every spelling either of them plausibly typed. Compared against
  -- lower(btrim(name)), so case and stray spaces are already handled.
  anvik_names     CONSTANT text[] := ARRAY['anvik', 'anvik.club', 'anvik club', 'anvikclub'];
  prelaunch_names CONSTANT text[] := ARRAY['pre launch', 'prelaunch', 'pre-launch', 'pre_launch'];

  keeper        text;
  anvik_dupes   text[];
  prelaunch_ids text[];
  folded        text[];
  rec           record;
  moved         int;
  total         int := 0;
  leftovers     int;
BEGIN
  -- ── who survives ─────────────────────────────────────────────────────
  -- Oldest wins, so the project that has been accumulating history longest
  -- is the one that keeps its id and every audit row already pointing at
  -- it. A newer duplicate is the accident, not the record.
  SELECT id INTO keeper
    FROM public.projects
   WHERE lower(btrim(name)) = ANY (anvik_names)
   ORDER BY created_at, id
   LIMIT 1;

  IF keeper IS NULL THEN
    RAISE EXCEPTION
      'No project named Anvik or anvik.club exists — refusing to guess which one to keep. Projects present: %',
      (SELECT coalesce(string_agg(quote_literal(name), ', ' ORDER BY name), '(none)') FROM public.projects);
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO anvik_dupes
    FROM public.projects
   WHERE lower(btrim(name)) = ANY (anvik_names) AND id <> keeper;

  SELECT coalesce(array_agg(id), '{}') INTO prelaunch_ids
    FROM public.projects
   WHERE lower(btrim(name)) = ANY (prelaunch_names);

  folded := anvik_dupes || prelaunch_ids;

  RAISE NOTICE 'keeper=% · anvik duplicates folded=% · pre-launch projects folded=%',
    keeper, coalesce(array_length(anvik_dupes, 1), 0), coalesce(array_length(prelaunch_ids, 1), 0);

  -- ── the type change, before the project change ───────────────────────
  -- Deliberately first: after the repoint below, a task that was in Pre
  -- Launch is indistinguishable from one that was always in Anvik. This is
  -- the only moment the distinction still exists in the data.
  IF coalesce(array_length(prelaunch_ids, 1), 0) > 0 THEN
    INSERT INTO public.audit_trail (id, actor_id, actor_label, entity_type, entity_id, field_name, old_value, new_value, source)
    SELECT 'aud-0042-type-' || t.id, NULL, 'Migration 0042', 'task', t.id, 'type', t.type, 'pre launch', 'portal'
      FROM public.tasks t
     WHERE t.project_id = ANY (prelaunch_ids) AND t.type IS DISTINCT FROM 'pre launch';

    UPDATE public.tasks SET type = 'pre launch'
     WHERE project_id = ANY (prelaunch_ids) AND type IS DISTINCT FROM 'pre launch';
    GET DIAGNOSTICS moved = ROW_COUNT;
    RAISE NOTICE 'tasks retyped to "pre launch": %', moved;

    INSERT INTO public.audit_trail (id, actor_id, actor_label, entity_type, entity_id, field_name, old_value, new_value, source)
    SELECT 'aud-0042-proj-' || t.id, NULL, 'Migration 0042', 'task', t.id, 'project_id', t.project_id, keeper, 'portal'
      FROM public.tasks t
     WHERE t.project_id = ANY (prelaunch_ids);
  END IF;

  -- ── repoint every column that references a folded project ────────────
  IF coalesce(array_length(folded, 1), 0) > 0 THEN
    FOR rec IN
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND c.confrelid = 'public.projects'::regclass
         AND array_length(c.conkey, 1) = 1
       ORDER BY 1, 2
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = ANY($2)', rec.tbl, rec.col, rec.col)
        USING keeper, folded;
      GET DIAGNOSTICS moved = ROW_COUNT;
      total := total + moved;
      IF moved > 0 THEN
        RAISE NOTICE 'repointed % row(s) in %.%', moved, rec.tbl, rec.col;
      END IF;
    END LOOP;

    RAISE NOTICE 'total rows repointed onto %: %', keeper, total;

    INSERT INTO public.audit_trail (id, actor_id, actor_label, entity_type, entity_id, field_name, old_value, new_value, source)
    SELECT 'aud-0042-del-' || p.id, NULL, 'Migration 0042', 'project', p.id, 'deleted', p.name, NULL, 'portal'
      FROM public.projects p WHERE p.id = ANY (folded);

    DELETE FROM public.projects WHERE id = ANY (folded);
    GET DIAGNOSTICS moved = ROW_COUNT;
    RAISE NOTICE 'projects deleted: %', moved;
  END IF;

  -- ── the rename ───────────────────────────────────────────────────────
  INSERT INTO public.audit_trail (id, actor_id, actor_label, entity_type, entity_id, field_name, old_value, new_value, source)
  SELECT 'aud-0042-name-' || p.id, NULL, 'Migration 0042', 'project', p.id, 'name', p.name, 'anvik.club', 'portal'
    FROM public.projects p WHERE p.id = keeper AND p.name <> 'anvik.club';

  UPDATE public.projects SET name = 'anvik.club' WHERE id = keeper AND name <> 'anvik.club';

  -- ── refuse to half-apply ─────────────────────────────────────────────
  -- A project row that survives here is one the app keeps offering in every
  -- picker, which is the whole thing being removed.
  SELECT count(*) INTO leftovers
    FROM public.projects
   WHERE lower(btrim(name)) = ANY (prelaunch_names)
      OR (lower(btrim(name)) = ANY (anvik_names) AND id <> keeper);

  IF leftovers > 0 THEN
    RAISE EXCEPTION 'Fold incomplete: % project row(s) still named Anvik or Pre Launch', leftovers;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = keeper AND name = 'anvik.club') THEN
    RAISE EXCEPTION 'Keeper % is not named anvik.club after the rename', keeper;
  END IF;

  RAISE NOTICE 'done — % is anvik.club', keeper;
END
$mig$;

COMMIT;
