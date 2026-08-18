-- Owner RLS for the strictly-personal tables.
--
-- Phase 1 filtered these in the client. This enforces it at the database, for
-- the tables where there is no legitimate reason to read the other person's
-- rows: my day plan, my logged hours, my life admin, my closeouts, my calendar.
-- Everything else (tasks, notes, pages, messages) deliberately keeps the
-- team-wide policy, because assignment, promote-to-task, money↔task links and
-- the Us thread all need to read across the two workspaces.
--
-- NULL user_id stays visible to both, on purpose. `day_events` documents NULL
-- as "a shared block both people see", and the three older tables allow NULL
-- too. A strict `user_id = auth.uid()` would make any such row unreadable and
-- undeletable by *either* person — data that exists but nobody can reach, which
-- looks exactly like data loss. The app has always written user_id on insert
-- (see StudyTimer, LifeAdmin, the closeout and day-plan writers), so this only
-- covers rows predating that.
--
-- Safe to re-run.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'day_plans',
    'day_events',
    'daily_closeouts',
    'time_logs',
    'life_admin'
  ] LOOP
    -- Create the owner policy before dropping the team one: if this
    -- transaction fails halfway, the table is never left with no policy at all
    -- (which under RLS denies everyone, including the owner).
    EXECUTE format('DROP POLICY IF EXISTS own_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY own_all ON public.%I FOR ALL
         USING (public.is_team_member() AND (user_id = auth.uid() OR user_id IS NULL))
         WITH CHECK (public.is_team_member() AND (user_id = auth.uid() OR user_id IS NULL))',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS team_all ON public.%I', t);
  END LOOP;
END $$;
