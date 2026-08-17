import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import { generateTaskExport, pinNumber } from './exportTask';
import { rankTasks } from './ranking';

describe('export determinism (gate §6 correctness)', () => {
  it('two consecutive exports of identical task state are byte-identical', () => {
    const ds = seedDataset();
    const a = generateTaskExport(ds, 'T-42');
    const b = generateTaskExport(ds, 'T-42');
    expect(a).toBe(b);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('contains no generated-at timestamp and uses ISO-8601 UTC for decisions', () => {
    const md = generateTaskExport(seedDataset(), 'T-42');
    expect(md).not.toMatch(/generated/i);
    expect(md).toMatch(/\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\):/);
  });

  it('coordinates render to exactly one decimal', () => {
    const md = generateTaskExport(seedDataset(), 'T-42');
    expect(md).toContain('(x 32.4%, y 41.0%)');
  });

  it('acceptance criteria render as checkboxes; subtask fallback warns', () => {
    const ds = seedDataset();
    expect(generateTaskExport(ds, 'T-42')).toContain('- [ ] Pre-2019 records parse');
    const md47 = generateTaskExport(ds, 'T-47'); // no criteria → subtask fallback
    expect(md47).toContain('Warning: no acceptance criteria');
    expect(md47).toContain('- [ ] Compare landed cost with duty');
  });
});

describe('pin numbering', () => {
  it('stays contiguous after deleting a middle pin', () => {
    const ds = seedDataset();
    // add a third pin, then delete the middle one
    ds.annotation_pins.push({
      id: 'pin-3',
      screenshot_id: 'shot-1',
      x_pct: 10.0,
      y_pct: 10.0,
      note: 'third',
      author_id: 'u-anadya',
      is_resolved: false,
      created_at: '2026-08-17T09:20:00+05:30',
    });
    ds.annotation_pins = ds.annotation_pins.filter((p) => p.id !== 'pin-2');
    expect(pinNumber(ds, 'pin-1')).toBe(1);
    expect(pinNumber(ds, 'pin-3')).toBe(2); // no gap
    const md = generateTaskExport(ds, 'T-42');
    expect(md).toContain('1. (x 32.4%');
    expect(md).toContain('2. (x 10.0%');
    expect(md).not.toContain('3. (x');
  });
});

describe('ranking', () => {
  it('changes when ranking_weights changes, no redeploy', () => {
    const ds = seedDataset();
    const before = rankTasks(ds, '2026-08-18');
    ds.ranking_weights = { ...ds.ranking_weights, objective_fit: 0, unblocks: 0, deadline: 100 };
    const after = rankTasks(ds, '2026-08-18');
    expect(before.map((r) => r.score)).not.toEqual(after.map((r) => r.score));
  });

  it('excludes personal-project tasks entirely (principle 7)', () => {
    const ranked = rankTasks(seedDataset(), '2026-08-18');
    expect(ranked.some((r) => r.task.project_id === 'personal')).toBe(false);
  });

  it('a task with no objective sinks in rank', () => {
    const ranked = rankTasks(seedDataset(), '2026-08-18');
    const noObj = ranked.findIndex((r) => r.task.id === 'T-38');
    expect(noObj).toBeGreaterThan(ranked.length / 2);
  });
});
