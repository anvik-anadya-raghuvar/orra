import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import { generateTaskExport, generateTaskHtml } from './exportTask';

const TASK = 'T-42';

describe('HTML export determinism (principle 5)', () => {
  it('is byte-identical for identical task state', () => {
    // The whole reason the export is a pure function: two people generating
    // the same task must be able to diff the results and see nothing.
    expect(generateTaskHtml(seedDataset(), TASK)).toBe(generateTaskHtml(seedDataset(), TASK));
  });

  it('is byte-identical across repeated calls on one dataset', () => {
    const ds = seedDataset();
    expect(generateTaskHtml(ds, TASK)).toBe(generateTaskHtml(ds, TASK));
  });

  it('reads no clock — output has no timestamp of its own', () => {
    const html = generateTaskHtml(seedDataset(), TASK);
    const thisYear = String(new Date().getFullYear());
    // Seeded task data is 2026; the failure this guards against is a
    // "generated at" line, which would differ between the two of them.
    expect(html).not.toContain('Generated');
    expect(html.includes(thisYear) && !html.includes('2026')).toBe(false);
  });

  it('changes when the task changes', () => {
    const ds = seedDataset();
    const before = generateTaskHtml(ds, TASK);
    ds.tasks = ds.tasks.map((t) => (t.id === TASK ? { ...t, title: 'Something else entirely' } : t));
    expect(generateTaskHtml(ds, TASK)).not.toBe(before);
  });

  it('throws for a task that does not exist, like the markdown does', () => {
    expect(() => generateTaskHtml(seedDataset(), 'T-nope')).toThrow();
  });
});

describe('HTML export content', () => {
  const html = generateTaskHtml(seedDataset(), TASK);

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8" />');
  });

  it('carries the same headings the markdown does', () => {
    const md = generateTaskExport(seedDataset(), TASK);
    for (const heading of ['Objective', 'Decisions', 'Background', 'Acceptance criteria']) {
      expect(md).toContain(`## ${heading}`);
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
  });

  it('names the task in the title and the h1', () => {
    expect(html).toContain(`<title>${TASK}`);
    expect(html).toContain(`<h1>${TASK}`);
  });

  it('embeds screenshots inline so the file survives being emailed', () => {
    const ds = seedDataset();
    const shot = ds.screenshot_attachments.find((s) => s.task_id === TASK);
    if (shot?.data_url) {
      expect(generateTaskHtml(ds, TASK)).toContain(shot.data_url);
    } else {
      // No seeded image for this task — assert the honest fallback instead of
      // silently passing on a branch that never ran.
      expect(generateTaskHtml(ds, TASK)).not.toContain('<img class="shot"');
    }
  });
});

describe('escaping', () => {
  it('escapes markup in a title rather than letting it render', () => {
    const ds = seedDataset();
    ds.tasks = ds.tasks.map((t) =>
      t.id === TASK ? { ...t, title: '<script>alert(1)</script> & "quoted"' } : t,
    );
    const html = generateTaskHtml(ds, TASK);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes markup in the description too', () => {
    const ds = seedDataset();
    ds.tasks = ds.tasks.map((t) => (t.id === TASK ? { ...t, description: '<b>bold</b>' } : t));
    expect(generateTaskHtml(ds, TASK)).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

describe('the Word variant', () => {
  it('differs from the plain one only in the root element', () => {
    const plain = generateTaskHtml(seedDataset(), TASK);
    const word = generateTaskHtml(seedDataset(), TASK, { forWord: true });
    expect(word).toContain('urn:schemas-microsoft-com:office:word');
    expect(plain).not.toContain('urn:schemas-microsoft-com:office:word');
    // Same body, so the two formats can never disagree about content.
    const body = (doc: string) => doc.slice(doc.indexOf('<body>'));
    expect(body(word)).toBe(body(plain));
  });

  it('is deterministic as well', () => {
    expect(generateTaskHtml(seedDataset(), TASK, { forWord: true })).toBe(
      generateTaskHtml(seedDataset(), TASK, { forWord: true }),
    );
  });
});
