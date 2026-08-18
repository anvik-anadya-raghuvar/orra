import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
  day_events: 'day_events',
};

/**
 * Supabase adapter. Reads the full dataset on load; writes are row-level
 * upserts of only the changed rows. audit_trail is INSERT-only (UPDATE/DELETE
 * are revoked at the database — see migration 0001).
 */
export function createSupabaseAdapter(url: string, anonKey: string): DataAdapter {
  const sb: SupabaseClient = createClient(url, anonKey);
  const knownIds = new Map<CollectionKey, Set<string>>();

  return {
    kind: 'supabase',
    async load() {
      const keys = Object.keys(TABLE) as CollectionKey[];
      const results = await Promise.all(
        keys.map((k) => sb.from(TABLE[k]).select('*').then((r) => [k, r.data ?? []] as const)),
      );
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
        if (key === 'audit_trail') {
          void sb.from(table).insert(changed as never[]);
        } else {
          void sb.from(table).upsert(changed as never[]);
        }
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
          void sb.from(table).delete().in('id', gone);
          gone.forEach((id) => known.delete(id));
        }
      }
    },
    saveWeights(w) {
      void sb.from('ranking_weights').upsert(w);
    },
    async authedEmail() {
      const { data } = await sb.auth.getUser();
      return data.user?.email ?? null;
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
