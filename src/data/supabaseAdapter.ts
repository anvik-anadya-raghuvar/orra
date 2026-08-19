import type { SupabaseClient } from '@supabase/supabase-js';
import type { CollectionKey, Dataset } from '../types';
import type { DataAdapter } from './adapter';

/** Collection key → table name (1:1 except documents). */
const TABLE: Record<CollectionKey, string> = {
  profiles: 'profiles',
  projects: 'projects',
  tags: 'tags',
  objectives: 'objectives',
  key_results: 'key_results',
  tasks: 'tasks',
  subtasks: 'subtasks',
  comments: 'comments',
  screenshot_attachments: 'screenshot_attachments',
  annotation_pins: 'annotation_pins',
  decisions: 'decisions',
  notes: 'notes',
  mail_items: 'mail_items',
  documents: 'documents',
  people: 'people',
  people_interactions: 'people_interactions',
  messages: 'messages',
  shared_daily: 'shared_daily',
  courses: 'courses',
  course_items: 'course_items',
  reading_queue: 'reading_queue',
  time_logs: 'time_logs',
  life_admin: 'life_admin',
  fixed_dates: 'fixed_dates',
  ledger: 'ledger',
  import_batches: 'import_batches',
  audit_trail: 'audit_trail',
  automation_rules: 'automation_rules',
  daily_closeouts: 'daily_closeouts',
  day_plans: 'day_plans',
  day_plan_items: 'day_plan_items',
  day_events: 'day_events',
  active_blocks: 'active_blocks',
  personal_goals: 'personal_goals',
  mood_items: 'mood_items',
  subscriptions: 'subscriptions',
  pulse_items: 'pulse_items',
  task_links: 'task_links',
  sprints: 'sprints',
  pages: 'pages',
  page_comments: 'page_comments',
  integration_grants: 'integration_grants',
  trash_items: 'trash_items',
};

/**
 * Supabase adapter. Reads the full dataset on load; writes are row-level
 * upserts of only the changed rows. audit_trail is INSERT-only (UPDATE/DELETE
 * are revoked at the database — see migration 0001).
 */
export function createSupabaseAdapter(sb: SupabaseClient): DataAdapter {
  const knownIds = new Map<CollectionKey, Set<string>>();
  let onError: ((msg: string) => void) | null = null;

  return {
    kind: 'supabase',
    async load() {
      const keys = Object.keys(TABLE) as CollectionKey[];
      const raw = await Promise.all(
        keys.map((k) => sb.from(TABLE[k]).select('*').then((r) => [k, r] as const)),
      );
      // A table that failed to load is not the same fact as a table that is
      // genuinely empty — collapsing them (r.data ?? []) makes an expired
      // session or a network hiccup render as "you have no data anywhere",
      // indistinguishable from a fresh, workspace-wiping bug. If most/every
      // table failed the same way, that is one failure (a dead session, most
      // likely), not forty — surface it once and let the caller retry.
      const failed = raw.filter(([, r]) => r.error);
      if (failed.length > keys.length / 2) {
        const first = failed[0][1].error;
        throw new Error(
          `Couldn't load your data (${first?.message ?? 'unknown error'}). ` +
            `Your session may have expired — try signing in again.`,
        );
      }
      for (const [k, r] of failed) {
        console.error(`[supabaseAdapter] failed to load ${TABLE[k]}:`, r.error?.message);
      }
      const results = raw.map(([k, r]) => [k, r.data ?? []] as const);
      const weights = await sb.from('ranking_weights').select('*').limit(1).single();
      const ds = Object.fromEntries(results) as unknown as Dataset;
      ds.ranking_weights = (weights.data as Dataset['ranking_weights']) ?? {
        id: 1,
        objective_fit: 40,
        unblocks: 30,
        deadline: 30,
        updated_at: new Date().toISOString(),
      };
      for (const [k, rows] of results) {
        knownIds.set(k, new Set((rows as { id: string }[]).map((r) => r.id)));
      }
      return ds;
    },
    saveCollection(key, rows, changed) {
      const table = TABLE[key];
      // The local-only password field must never reach the profiles table.
      if (key === 'profiles' && changed) {
        changed = (changed as Record<string, unknown>[]).map(({ password: _pw, ...rest }) => rest);
      }
      if (changed && changed.length) {
        const write =
          key === 'audit_trail'
            ? sb.from(table).insert(changed as never[])
            : sb.from(table).upsert(changed as never[]);
        // Fire-and-forget from the caller's point of view (the UI already
        // updated optimistically), but a failure here must not vanish —
        // that is exactly "I created it and it's gone after refresh."
        void write.then(({ error }) => {
          if (error) {
            console.error(`[supabaseAdapter] failed to save ${table}:`, error.message);
            onError?.(`Couldn't save to ${table.replace(/_/g, ' ')} — ${error.message}`);
          }
        });
        const known = knownIds.get(key) ?? new Set<string>();
        for (const row of changed as { id: string }[]) known.add(row.id);
        knownIds.set(key, known);
      } else {
        // No changed set → a removal happened; delete the missing ids.
        const known = knownIds.get(key);
        if (!known) return;
        const present = new Set((rows as { id: string }[]).map((r) => r.id));
        const gone = [...known].filter((id) => !present.has(id));
        if (gone.length && key !== 'audit_trail') {
          void sb
            .from(table)
            .delete()
            .in('id', gone)
            .then(({ error }) => {
              if (error) {
                console.error(`[supabaseAdapter] failed to delete from ${table}:`, error.message);
                onError?.(`Couldn't delete from ${table.replace(/_/g, ' ')} — ${error.message}`);
                // Do NOT forget these ids on failure. The old code deleted
                // them from `known` unconditionally, so a rejected DELETE
                // (e.g. a foreign key still pointing at the row) looked
                // identical to a successful one — the row reappeared on the
                // next reload with the adapter having no memory it was ever
                // "still there" to retry.
                return;
              }
              gone.forEach((id) => known.delete(id));
            });
        }
      }
    },
    saveWeights(w) {
      void sb
        .from('ranking_weights')
        .upsert(w)
        .then(({ error }) => {
          if (error) {
            console.error('[supabaseAdapter] failed to save ranking_weights:', error.message);
            onError?.(`Couldn't save ranking weights — ${error.message}`);
          }
        });
    },
    async authedEmail() {
      const { data } = await sb.auth.getUser();
      return data.user?.email ?? null;
    },
    onSyncError(cb) {
      onError = cb;
    },
    async deleteRows(key, ids) {
      if (!ids.length) return null;
      const { error } = await sb.from(TABLE[key]).delete().in('id', ids);
      if (error) return error.message;
      // Keep local bookkeeping in step with the confirmed delete, so a later
      // optimistic saveCollection() on the same collection doesn't try to
      // re-delete ids Postgres has already forgotten.
      const known = knownIds.get(key);
      if (known) ids.forEach((id) => known.delete(id));
      return null;
    },
    onRemoteChange(cb) {
      // Realtime on the chat-critical tables; other screens refetch on focus.
      const channel = sb
        .channel('anvik-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => refetch('messages'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => refetch('tasks'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_daily' }, () => refetch('shared_daily'))
        .subscribe();
      const refetch = async (key: CollectionKey) => {
        const { data } = await sb.from(TABLE[key]).select('*');
        if (data) cb({ [key]: data } as Partial<Dataset>);
      };
      return () => {
        void sb.removeChannel(channel);
      };
    },
  };
}
