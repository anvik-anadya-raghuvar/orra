-- One spelling for the scheduling edge.
--
-- `blocks` and `blocked_by` record the same fact in opposite directions. The
-- UI has always treated them as one (canonicalLink in screens/work/common.tsx),
-- but now the scheduler reads these rows to compute a reflow, and carrying two
-- spellings means every reader has to remember to normalise. Rewrite the
-- backwards ones and keep only `blocks`.
--
-- `related` and `child_of` are untouched: they carry no timing meaning.
-- Safe to re-run.

-- Flip A blocked_by B into B blocks A, unless that row already exists.
UPDATE public.task_links AS l
   SET from_task_id = l.to_task_id,
       to_task_id   = l.from_task_id,
       type         = 'blocks'
 WHERE l.type = 'blocked_by'
   AND NOT EXISTS (
     SELECT 1 FROM public.task_links AS m
      WHERE m.type = 'blocks'
        AND m.from_task_id = l.to_task_id
        AND m.to_task_id   = l.from_task_id
   );

-- Anything left was a duplicate of an existing `blocks` row.
DELETE FROM public.task_links WHERE type = 'blocked_by';

-- The type stays in the CHECK constraint: the quick-edit still offers "is
-- blocked by" as a way to say it, and normalises before inserting. Removing it
-- would break that form for no gain.
