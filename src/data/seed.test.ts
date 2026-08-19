import { describe, expect, it } from 'vitest';
import { AN, RG, TEST, seedDataset, seedTestDataset } from './seed';

describe('development test workspace fixtures', () => {
  it('owns every private module without changing either founder fixture', () => {
    const main = seedDataset();
    const test = seedTestDataset();

    expect(test.profiles.find((profile) => profile.id === AN)).toEqual(
      main.profiles.find((profile) => profile.id === AN),
    );
    expect(test.profiles.find((profile) => profile.id === RG)).toEqual(
      main.profiles.find((profile) => profile.id === RG),
    );
    expect(main.tasks.some((task) => task.assignee_id === TEST)).toBe(false);

    expect(test.tasks.length).toBeGreaterThan(0);
    expect(test.tasks.every((task) => task.assignee_id === TEST)).toBe(true);
    expect(test.notes.every((note) => note.owner_id === TEST)).toBe(true);
    expect(test.mail_items.every((item) => item.owner_id === TEST)).toBe(true);
    expect(test.documents.every((item) => item.owner_id === TEST)).toBe(true);
    expect(test.courses.every((course) => course.owner_id === TEST)).toBe(true);
    expect(test.reading_queue.every((item) => item.owner_id === TEST)).toBe(true);
    expect(test.time_logs.every((log) => log.user_id === TEST)).toBe(true);
    expect(test.life_admin.every((item) => item.user_id === TEST)).toBe(true);
    expect(test.personal_goals.every((goal) => goal.user_id === TEST)).toBe(true);
  });

  it('includes current-day, moment, moodboard, and order examples', () => {
    const test = seedTestDataset();

    expect(test.day_plans.some((plan) => plan.user_id === TEST)).toBe(true);
    expect(test.day_plan_items.some((item) => item.user_id === TEST)).toBe(true);
    expect(test.day_events.some((event) => event.user_id === TEST)).toBe(true);
    expect(test.messages.some((message) => message.kind === 'photo' && message.attachment_url?.startsWith('data:image/'))).toBe(true);
    expect(test.messages.some((message) => message.kind === 'song' && message.song_ref)).toBe(true);
    expect(test.mood_items.some((item) => item.user_id === TEST && item.kind === 'image')).toBe(true);
    expect(test.mood_items.some((item) => item.user_id === TEST && item.kind === 'song')).toBe(true);
    expect(test.personal_orders.some((order) => order.user_id === TEST && order.kind === 'physical')).toBe(true);
    expect(test.personal_orders.some((order) => order.user_id === TEST && order.kind === 'travel')).toBe(true);
    expect(test.screenshot_attachments.every((shot) => shot.data_url?.startsWith('data:image/'))).toBe(true);
    expect(test.notes.some((note) => note.images?.some((image) => image.data_url.startsWith('data:image/')))).toBe(true);
    expect(test.import_batches.some((batch) => batch.imported_by === TEST)).toBe(true);
    expect(test.ledger.every((entry) => entry.paid_by === TEST)).toBe(true);
  });
});
