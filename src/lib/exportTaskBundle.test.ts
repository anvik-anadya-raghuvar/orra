import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { AN, RG, seedDataset } from '../data/seed';
import {
  EXPORT_CAPS,
  ZIP_FIXED_DATE,
  bundleReadme,
  exportTaskZip,
  generateTaskContext,
  generateTaskExport,
  isManualCriterion,
} from './exportTask';
import type { Dataset } from '../types';

const TASK = 'T-42';
/* Not a decodable PNG on purpose: Node has no canvas, and a browser that
   cannot decode it takes the same fallback. Either way annotation fails and
   the fallback path — the one that has to stay deterministic too — runs. */
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

function withImage(ds = seedDataset()): Dataset {
  ds.screenshot_attachments.find((s) => s.id === 'shot-1')!.data_url = IMG;
  return ds;
}

const taskOf = (ds: Dataset, id = TASK) => ds.tasks.find((t) => t.id === id)!;

async function unzip(blob: Blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe('context zip — reproducible (principle 5)', () => {
  it('two runs over identical state are byte-identical', async () => {
    const a = new Uint8Array(await (await exportTaskZip(withImage(), TASK)).arrayBuffer());
    const b = new Uint8Array(await (await exportTaskZip(withImage(), TASK)).arrayBuffer());
    expect(a.length).toBeGreaterThan(0);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('stamps every entry, folders included, with the fixed date — never the clock', async () => {
    const zip = await unzip(await exportTaskZip(withImage(), TASK));
    const entries = Object.values(zip.files);
    expect(entries.length).toBeGreaterThan(3);
    for (const f of entries) expect(f.date.getTime()).toBe(ZIP_FIXED_DATE.getTime());
  });
});

describe('context zip — layout', () => {
  it('unpacks into one top folder, with no README.md to clobber a repo', async () => {
    const zip = await unzip(await exportTaskZip(withImage(), TASK));
    const names = Object.keys(zip.files);
    expect(names.every((n) => n.startsWith('orra-T-42/'))).toBe(true);
    expect(names).toContain('orra-T-42/TASK.md');
    expect(names).toContain('orra-T-42/HOW-TO-READ.md');
    expect(names).toContain('orra-T-42/CONTEXT.json');
    expect(names.some((n) => /README/i.test(n))).toBe(false);
  });

  it('references only files it wrote, and does not claim markers it could not draw', async () => {
    const zip = await unzip(await exportTaskZip(withImage(), TASK));
    const names = new Set(Object.keys(zip.files));
    const md = await zip.file('orra-T-42/TASK.md')!.async('string');
    const ctx = JSON.parse(await zip.file('orra-T-42/CONTEXT.json')!.async('string'));
    const readme = await zip.file('orra-T-42/HOW-TO-READ.md')!.async('string');
    // Node has no canvas, so this is the fallback: clean image only.
    expect(md).not.toContain('Numbered markers are drawn');
    expect(md).toContain('Markers could not be drawn');
    expect(md).toContain('![screenshot-1](assets/01-samadhaan_grid.png)');
    const shot = ctx.screenshots[0];
    expect(shot.markers_drawn).toBe(false);
    expect(shot.annotated_asset).toBeNull();
    expect(shot.original_asset).toBe('assets/01-samadhaan_grid.png');
    for (const path of [shot.annotated_asset, shot.original_asset].filter(Boolean)) {
      expect(names.has(`orra-T-42/${path}`)).toBe(true);
    }
    expect(names.has('orra-T-42/assets/original-01-samadhaan_grid.png')).toBe(false);
    expect(readme).not.toContain('assets/original-');
    expect(readme).not.toContain('numbered markers drawn');
  });

  it('writes no assets folder and points at no image when nothing is stored', async () => {
    const zip = await unzip(await exportTaskZip(seedDataset(), TASK));
    expect(Object.keys(zip.files).some((n) => n.includes('assets/'))).toBe(false);
    const ctx = JSON.parse(await zip.file('orra-T-42/CONTEXT.json')!.async('string'));
    expect(ctx.screenshots[0].annotated_asset).toBeNull();
    expect(ctx.screenshots[0].original_asset).toBeNull();
  });
});

describe('HOW-TO-READ.md', () => {
  it('keeps its blank lines and ends with a newline', () => {
    const text = bundleReadme(withImage(), TASK);
    expect(text).toContain('\n\n## Contents\n\n');
    expect(text).toContain('\n\n## How to read it\n\n');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('standalone markdown (the .md download and Copy TASK.md)', () => {
  it('replaces image links with a pointer to the zip', () => {
    const md = generateTaskExport(withImage(), TASK, { standalone: true });
    expect(md).not.toContain('](assets/');
    expect(md).toContain('(screenshot 1 — included in the Context folder zip)');
    expect(md).not.toContain('Numbered markers are drawn');
  });

  it('is deterministic too', () => {
    expect(generateTaskExport(withImage(), TASK, { standalone: true })).toBe(
      generateTaskExport(withImage(), TASK, { standalone: true }),
    );
  });
});

describe('code context (0053)', () => {
  it('prints repo, the task branch over the project default, and paths', () => {
    const ds = seedDataset();
    const project = ds.projects.find((p) => p.id === 'reg')!;
    project.repo_url = 'https://github.com/example/registry';
    project.default_branch = 'main';
    const task = taskOf(ds);
    task.branch = 'fix/ecourts-pre2019';
    task.code_paths = 'src/collectors/ecourts/parse.ts\n\n  src/collectors/ecourts/fixtures/  \n';
    const md = generateTaskExport(ds, TASK);
    expect(md).toContain('## Code context\n- Repository: `https://github.com/example/registry`\n- Branch: `fix/ecourts-pre2019`\n- Paths:\n  - `src/collectors/ecourts/parse.ts`\n  - `src/collectors/ecourts/fixtures/`');
    const ctx = JSON.parse(generateTaskContext(ds, TASK));
    expect(ctx.code).toEqual({
      repo_url: 'https://github.com/example/registry',
      branch: 'fix/ecourts-pre2019',
      branch_source: 'task',
      paths: ['src/collectors/ecourts/parse.ts', 'src/collectors/ecourts/fixtures/'],
    });
  });

  it('falls back to the project default branch and says so', () => {
    const ds = seedDataset();
    ds.projects.find((p) => p.id === 'reg')!.default_branch = 'main';
    expect(generateTaskExport(ds, TASK)).toContain('- Branch: `main` (project default)');
  });

  it('shows for a non-code task only when something is set', () => {
    const ds = seedDataset();
    expect(generateTaskExport(ds, 'T-47')).not.toContain('## Code context');
    taskOf(ds, 'T-47').code_paths = 'docs/vendors.md';
    expect(generateTaskExport(ds, 'T-47')).toContain('## Code context');
  });
});

describe('TASK.md content', () => {
  it('carries types, tags, start date and the blocked reason in the header', () => {
    const ds = seedDataset();
    const md = generateTaskExport(ds, TASK);
    expect(md).toContain('Type: code_change · Tags: urgent-path');
    expect(md).toContain('Start: 2026-08-16 · Due: 2026-08-20');
    const t44 = generateTaskExport(ds, 'T-44');
    expect(t44).toContain('> **Blocked:** Needs fixture confirmation from Anadya');
    taskOf(ds, 'T-44').is_stuck = true;
    expect(generateTaskExport(ds, 'T-44')).toContain('> **Stuck:**');
  });

  it('lists dependencies from both directions of task_links', () => {
    const ds = seedDataset(); // tl-1: T-44 blocked_by T-42
    expect(generateTaskExport(ds, TASK)).toContain('- Blocks: **T-44** · Samadhaan collector — queue reorder (in_progress)');
    expect(generateTaskExport(ds, 'T-44')).toContain('- Blocked by: **T-42** · eCourts collector — QA report (in_review)');
    // The same fact spelled the other way is listed once, not twice.
    ds.task_links.push({ id: 'tl-dup', from_task_id: TASK, to_task_id: 'T-44', type: 'blocks', created_by: AN, created_at: '2026-08-18T00:00:00Z' });
    expect(generateTaskExport(ds, TASK).match(/\*\*T-44\*\*/g)).toHaveLength(1);
  });

  it('always lists subtasks with their state, even when criteria exist', () => {
    const md = generateTaskExport(seedDataset(), TASK);
    expect(md).toContain('## Subtasks\n- [x] Rerun parser on DDL fixture\n- [x] Diff against portal HTML capture\n- [ ] Write QA summary note');
  });

  it('puts non-decision comments in a chronological, capped Thread', () => {
    const ds = seedDataset();
    const md = generateTaskExport(ds, TASK);
    const thread = md.slice(md.indexOf('## Thread'), md.indexOf('## Background'));
    expect(thread).toContain('Pinned the two divergent regions');
    expect(thread).not.toContain('Treat pre-2019'); // that one is a decision
    for (let i = 0; i < EXPORT_CAPS.threadComments + 5; i++) {
      ds.comments.push({ id: `cx-${String(i).padStart(2, '0')}`, task_id: TASK, author_id: AN, body: `comment ${i}`, is_decision: false, created_at: `2026-08-19T10:${String(i).padStart(2, '0')}:00Z` });
    }
    const capped = generateTaskExport(ds, TASK);
    expect(capped).toContain('_6 earlier comments omitted._');
    expect(capped).toContain(`comment ${EXPORT_CAPS.threadComments + 4}`);
    expect(capped.indexOf('comment 10')).toBeLessThan(capped.indexOf('comment 20'));
  });

  it('lists task files by name without bundling them', () => {
    const ds = seedDataset();
    ds.attachments.push({ id: 'att-1', entity_type: 'task', entity_id: TASK, filename: 'portal-capture.html', mime: 'text/html', bytes: 4000, storage_path: 'x/att-1', caption: 'Portal HTML capture', uploaded_by: RG, created_at: '2026-08-17T09:00:00Z' });
    const md = generateTaskExport(ds, TASK);
    expect(md).toContain('## Files');
    expect(md).toContain('- portal-capture.html (text/html, 4 KB) — Portal HTML capture');
    expect(JSON.parse(generateTaskContext(ds, TASK)).files[0].bundled).toBe(false);
  });

  it('separates resolved pins under "Resolved — do not act" and marks them in CONTEXT.json', () => {
    const ds = seedDataset();
    ds.annotation_pins.find((p) => p.id === 'pin-2')!.is_resolved = true;
    const md = generateTaskExport(ds, TASK);
    const [open, resolved] = md.split('Resolved — do not act:');
    expect(open).toContain('**Pin 1**');
    expect(open).not.toContain('**Pin 2**');
    expect(resolved.split('## Decisions')[0]).toContain('- **Pin 2**');
    const pins = JSON.parse(generateTaskContext(ds, TASK)).screenshots[0].pins;
    expect(pins[1]).toMatchObject({ number: 2, resolved: true, do_not_act: true });
    expect(pins[0].do_not_act).toBe(false);
  });

  it('says "Pins: none" for a screenshot with no pins', () => {
    const ds = seedDataset();
    ds.annotation_pins = [];
    expect(generateTaskExport(ds, TASK)).toContain('\nPins: none\n');
  });

  it('keeps multi-line decisions and pin notes inside their list item', () => {
    const ds = seedDataset();
    ds.comments.find((c) => c.id === 'c-2')!.body = 'First line.\nSecond line.\n\nAfter a gap.';
    ds.annotation_pins.find((p) => p.id === 'pin-1')!.note = 'Top\nBottom';
    const md = generateTaskExport(ds, TASK);
    expect(md).toContain('First line.\n  Second line.\n\n  After a gap.');
    expect(md).toContain('Top\n  Bottom');
  });

  it('escapes raw angle brackets in user text so renderers cannot swallow them', () => {
    const ds = seedDataset();
    ds.annotation_pins.find((p) => p.id === 'pin-1')!.note = 'Header <th> misaligned';
    ds.comments.find((c) => c.id === 'c-1')!.body = '> not a quote <b>bold</b>';
    const md = generateTaskExport(ds, TASK);
    expect(md).toContain('Header \\<th\\> misaligned');
    expect(md).toContain('\\> not a quote \\<b\\>bold\\</b\\>');
    expect(md).not.toContain('<th>');
  });

  it('carries the whole linked note up to the cap, not just its first line', () => {
    const ds = seedDataset();
    ds.notes.push({ ...ds.notes[0], id: 'n-x', title: 'Long', body: `line one\nline two\n${'x'.repeat(3000)}`, task_id: TASK, created_at: '2026-08-18T00:00:00Z' });
    const md = generateTaskExport(ds, TASK);
    expect(md).toContain('line one\n  line two');
    expect(md).toContain('…(truncated)');
    expect(md).not.toContain('x'.repeat(EXPORT_CAPS.noteBody));
  });

  it('includes only mail converted into this task (or its linked notes)', () => {
    const ds = seedDataset();
    const flagged = ds.mail_items.find((m) => m.project_id === 'reg' && m.flag_reason)!;
    flagged.converted_to_type = null;
    flagged.converted_to_id = null;
    expect(generateTaskExport(ds, TASK)).not.toContain(`Mail "${flagged.subject}"`);
    flagged.converted_to_type = 'task';
    flagged.converted_to_id = TASK;
    expect(generateTaskExport(ds, TASK)).toContain(`Mail "${flagged.subject}"`);
  });
});

describe('agent instructions follow the task type (principle 7)', () => {
  it('a code change gets a How to verify line and flags manual criteria', () => {
    const md = generateTaskExport(seedDataset(), TASK);
    const instructions = md.slice(md.indexOf('## Agent instructions'));
    expect(instructions).toContain('**How to verify:**');
    expect(instructions).toContain('paste its output');
    expect(md).toContain('- [ ] QA report attached to the task _(manual check — not provable from code)_');
    expect(md).toContain('- [ ] Pre-2019 records parse to the same fields the portal shows\n');
  });

  it('a research task gets no coding instructions', () => {
    const ds = seedDataset();
    const md = generateTaskExport(ds, 'T-40');
    const instructions = md.slice(md.indexOf('## Agent instructions'));
    expect(instructions).toContain('no code changes are expected');
    expect(instructions).not.toMatch(/diff|branch|Implement/);
    expect(md).not.toContain('## Code context');
  });

  it('manual-criterion detection is a fixed rule', () => {
    expect(isManualCriterion('Signed off by Anadya')).toBe(true);
    expect(isManualCriterion('Full fixture set green')).toBe(false);
  });
});
