import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import { generateTaskExport, pinNumber } from './exportTask';
import { capacityFit, planDay, rankTasks, stuckTasks } from './ranking';

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

  it('carries the pin label so an agent can tell a bug from a copy tweak', () => {
    const md = generateTaskExport(seedDataset(), 'T-42');
    expect(md).toContain('[bug] Date column shifted');
    expect(md).toContain('[logic] Case number truncated');
  });

  it('attributes linked notes to whoever wrote them', () => {
    const md = generateTaskExport(seedDataset(), 'T-42');
    expect(md).toMatch(/- Note "[^"]+" \((Anadya|Raghuvar)\):/);
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
      label: '',
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

describe('declared capacity — "how heavy do I want today to be"', () => {
  it('scores light work up and heavy work down on a light day', () => {
    expect(capacityFit('light', 'light')).toBeGreaterThan(capacityFit('heavy', 'light'));
    expect(capacityFit('heavy', 'light')).toBeLessThan(0);
    expect(capacityFit('heavy', 'heavy')).toBeGreaterThan(capacityFit('heavy', 'light'));
  });

  it('reshuffles the ranking when capacity changes', () => {
    const ds = seedDataset();
    const light = rankTasks(ds, '2026-08-18', 'light').map((r) => r.task.id);
    const heavy = rankTasks(ds, '2026-08-18', 'heavy').map((r) => r.task.id);
    expect(light).not.toEqual(heavy);
    // T-45 is a 90-minute heavy task: it must rank higher on a heavy day
    expect(heavy.indexOf('T-45')).toBeLessThan(light.indexOf('T-45'));
  });

  it('never lets capacity outrank urgency entirely', () => {
    // the top of a light day is still real work, not merely the lightest thing
    const top = rankTasks(seedDataset(), '2026-08-18', 'light')[0];
    expect(top.score).toBeGreaterThan(0);
    expect(['urgent', 'high', 'normal']).toContain(top.task.priority);
  });

  it('plans a day inside its minute budget', () => {
    const ds = seedDataset();
    const ranked = rankTasks(ds, '2026-08-18', 'light');
    const picked = planDay(ranked, 'light');
    const minutes = picked.reduce((a, r) => a + r.task.estimate_minutes, 0);
    expect(minutes).toBeLessThanOrEqual(180);
    expect(picked.length).toBeGreaterThan(0);
  });

  it('surfaces blocked work in the stuck zone instead of as "start here"', () => {
    const ds = seedDataset();
    const stuck = stuckTasks(ds);
    expect(stuck.some((s) => s.task.id === 'T-44')).toBe(true);
    // and a blocked task is pushed down the ranking
    const ranked = rankTasks(ds, '2026-08-18');
    expect(ranked[0].task.id).not.toBe('T-44');
  });
});

describe('handoff bundle honesty', () => {
  it('does not link an image the zip cannot contain', () => {
    // seed shot-1 has no stored image data
    const md = generateTaskExport(seedDataset(), 'T-42');
    expect(md).not.toContain('![screenshot-1](assets/');
    expect(md).toContain('No image data stored');
  });

  it('links the image and promises markers when data exists', () => {
    const ds = seedDataset();
    const shot = ds.screenshot_attachments.find((s) => s.id === 'shot-1')!;
    shot.data_url = 'data:image/png;base64,iVBORw0KGgo=';
    const md = generateTaskExport(ds, 'T-42');
    expect(md).toContain('![screenshot-1](assets/samadhaan_grid.png)');
    expect(md).toContain('Numbered markers are drawn on this image');
  });
});
