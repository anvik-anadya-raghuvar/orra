import { describe, expect, it } from 'vitest';
import { readChecklist, taskProgressPct, toggleChecklistLine } from './checklist';

describe('readChecklist', () => {
  it('finds boxes among ordinary prose and plain bullets', () => {
    const text = ['Ship the pricing page.', '', '- [ ] copy signed off', '- warm up the list', '- [x] staging deploy'].join('\n');
    expect(readChecklist(text)).toEqual([
      { line: 2, label: 'copy signed off', done: false },
      { line: 4, label: 'staging deploy', done: true },
    ]);
  });

  it('accepts * bullets, capital X, and indented boxes', () => {
    expect(readChecklist('  * [X] nested and done')).toEqual([
      { line: 0, label: 'nested and done', done: true },
    ]);
  });

  it('reads an empty box with no label rather than skipping the line', () => {
    expect(readChecklist('- [ ]')).toEqual([{ line: 0, label: '', done: false }]);
  });

  it('is empty for text with no boxes', () => {
    expect(readChecklist('just a paragraph')).toEqual([]);
    expect(readChecklist('')).toEqual([]);
  });
});

describe('toggleChecklistLine', () => {
  it('ticks and unticks, leaving every other line byte-identical', () => {
    const text = ['brief', '- [ ] one', '- [ ] two'].join('\n');
    const ticked = toggleChecklistLine(text, 1);
    expect(ticked).toBe(['brief', '- [x] one', '- [ ] two'].join('\n'));
    expect(toggleChecklistLine(ticked, 1)).toBe(text);
  });

  it('toggles by line, so two steps that read the same stay independent', () => {
    const text = ['- [ ] chase the invoice', '- [ ] chase the invoice'].join('\n');
    expect(toggleChecklistLine(text, 1)).toBe(['- [ ] chase the invoice', '- [x] chase the invoice'].join('\n'));
  });

  it('preserves indentation and the bullet character', () => {
    expect(toggleChecklistLine('   * [ ] nested', 0)).toBe('   * [x] nested');
  });

  it('leaves the text alone for a line that is not a box, or does not exist', () => {
    expect(toggleChecklistLine('plain line', 0)).toBe('plain line');
    expect(toggleChecklistLine('- [ ] one', 7)).toBe('- [ ] one');
  });
});

describe('taskProgressPct', () => {
  it('counts brief boxes and subtask rows as one list', () => {
    // 1 of 2 boxes + 1 of 2 subtasks = 2 of 4.
    expect(
      taskProgressPct('- [x] a\n- [ ] b', [{ completed: true }, { completed: false }]),
    ).toBe(50);
  });

  it('works from either half alone', () => {
    expect(taskProgressPct('- [x] a\n- [ ] b\n- [ ] c', [])).toBe(33);
    expect(taskProgressPct('no boxes here', [{ completed: true }])).toBe(100);
  });

  it('is null when there is nothing to count, so a hand-set percentage survives', () => {
    expect(taskProgressPct('just prose', [])).toBeNull();
    expect(taskProgressPct('', [])).toBeNull();
  });
});
