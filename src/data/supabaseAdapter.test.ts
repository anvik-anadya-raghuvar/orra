import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdapter } from './supabaseAdapter';

/**
 * A fake client whose writes take as long as their payload is big — the
 * shape of the real race: a screenshot row carries its image, a pin does not.
 */
function fakeClient(log: string[]) {
  const write = (table: string, verb: string, rows: { id: string }[] | string[]) => {
    let started = false;
    const run = () => {
      if (started) throw new Error('sent twice');
      started = true;
      const label = `${verb} ${table} ${rows.map((r) => (typeof r === 'string' ? r : r.id)).join(',')}`;
      log.push(`start ${label}`);
      const delay = table === 'screenshot_attachments' ? 30 : 1;
      return new Promise<{ error: null }>((resolve) =>
        setTimeout(() => {
          log.push(`done ${label}`);
          resolve({ error: null });
        }, delay),
      );
    };
    return { then: (ok: (v: { error: null }) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad) };
  };
  return {
    from: (table: string) => ({
      upsert: (rows: { id: string }[]) => write(table, 'upsert', rows),
      insert: (rows: { id: string }[]) => write(table, 'insert', rows),
      delete: () => ({ in: (_col: string, ids: string[]) => write(table, 'delete', ids) }),
    }),
  } as unknown as SupabaseClient;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('supabase adapter write ordering', () => {
  it('holds a pin until the screenshot it points at has saved', async () => {
    const log: string[] = [];
    const adapter = createSupabaseAdapter(fakeClient(log));
    const shot = { id: 'shot-1', task_id: 'T-1', data_url: 'x'.repeat(1000) };
    const pin = { id: 'pin-1', screenshot_id: 'shot-1', note: 'fix' };
    adapter.saveCollection('screenshot_attachments', [shot] as never, [shot] as never);
    adapter.saveCollection('annotation_pins', [pin] as never, [pin] as never);
    await settle();
    expect(log.indexOf('start upsert annotation_pins pin-1')).toBeGreaterThan(
      log.indexOf('done upsert screenshot_attachments shot-1'),
    );
  });

  it('leaves unrelated writes in parallel', async () => {
    const log: string[] = [];
    const adapter = createSupabaseAdapter(fakeClient(log));
    const shot = { id: 'shot-1', task_id: 'T-1' };
    const other = { id: 'pin-9', screenshot_id: 'shot-elsewhere', note: 'x' };
    adapter.saveCollection('screenshot_attachments', [shot] as never, [shot] as never);
    adapter.saveCollection('annotation_pins', [other] as never, [other] as never);
    await settle();
    // The pin did not wait: it went out, and finished, while the image was still uploading.
    expect(log.indexOf('done upsert annotation_pins pin-9')).toBeLessThan(
      log.indexOf('done upsert screenshot_attachments shot-1'),
    );
  });

  it('sends a second write of the same row after the first', async () => {
    const log: string[] = [];
    const adapter = createSupabaseAdapter(fakeClient(log));
    const a = { id: 'shot-1', task_id: 'T-1', filename: 'a' };
    const b = { ...a, filename: 'b' };
    adapter.saveCollection('screenshot_attachments', [a] as never, [a] as never);
    adapter.saveCollection('screenshot_attachments', [b] as never, [b] as never);
    await settle();
    expect(log.filter((line) => line.includes('shot-1'))).toEqual([
      'start upsert screenshot_attachments shot-1',
      'done upsert screenshot_attachments shot-1',
      'start upsert screenshot_attachments shot-1',
      'done upsert screenshot_attachments shot-1',
    ]);
  });
});
