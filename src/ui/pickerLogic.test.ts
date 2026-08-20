import { describe, expect, it } from 'vitest';
import { filterOptions, resolveCommit, type ComboOption } from './pickerLogic';

const opts: ComboOption[] = [
  { id: 'p1', label: 'Anvik' },
  { id: 'p2', label: 'Rain gear' },
  { id: 'p3', label: 'Registry' },
];

describe('filtering the list as you type', () => {
  it('matches anywhere in the name, not just the start', () => {
    // short human-named lists — "gear" should find "Rain gear"
    expect(filterOptions('gear', opts).map((o) => o.id)).toEqual(['p2']);
  });

  it('ignores case and surrounding space', () => {
    expect(filterOptions('  REGIS ', opts).map((o) => o.id)).toEqual(['p3']);
  });

  it('shows everything when nothing is typed', () => {
    expect(filterOptions('', opts)).toHaveLength(3);
    expect(filterOptions('   ', opts)).toHaveLength(3);
  });

  it('returns nothing when there is no match', () => {
    expect(filterOptions('zzz', opts)).toEqual([]);
  });
});

describe('what committing the typed text means', () => {
  it('creates when the name is new', () => {
    expect(resolveCommit('Consumer', opts)).toEqual({ kind: 'create', name: 'Consumer' });
  });

  it('selects an exact match instead of creating a duplicate', () => {
    expect(resolveCommit('Anvik', opts)).toEqual({ kind: 'select', id: 'p1' });
  });

  it('treats a differently-cased exact match as the same name', () => {
    // the whole point: "consumer" must never become a second "Consumer"
    expect(resolveCommit('anvik', opts)).toEqual({ kind: 'select', id: 'p1' });
    expect(resolveCommit('  ANVIK  ', opts)).toEqual({ kind: 'select', id: 'p1' });
  });

  it('still creates when the text only partially matches', () => {
    // "Rain" contains-matches "Rain gear" for filtering, but committing it
    // means a new project called Rain, not a silent snap to the neighbour
    expect(resolveCommit('Rain', opts)).toEqual({ kind: 'create', name: 'Rain' });
  });

  it('trims the name it would create', () => {
    expect(resolveCommit('  Consumer  ', opts)).toEqual({ kind: 'create', name: 'Consumer' });
  });

  it('clears the field when the input is empty', () => {
    expect(resolveCommit('', opts)).toEqual({ kind: 'none' });
    expect(resolveCommit('   ', opts)).toEqual({ kind: 'none' });
  });

  it('refuses to create a name that exists outside this picker view', () => {
    // a business-only field cannot see a personal project, and creating one
    // under the same name would quietly produce two
    const visible = [{ id: 'p1', label: 'Anvik' }];
    const all = ['Anvik', 'Personal'];
    expect(resolveCommit('Personal', visible, all)).toEqual({ kind: 'blocked', name: 'Personal' });
  });

  it('prefers selecting over blocking when the name is visible', () => {
    const all = ['Anvik', 'Personal'];
    expect(resolveCommit('Anvik', opts, all)).toEqual({ kind: 'select', id: 'p1' });
  });

  it('creates normally when allNames is supplied but has no hit', () => {
    expect(resolveCommit('Consumer', opts, ['Anvik'])).toEqual({
      kind: 'create',
      name: 'Consumer',
    });
  });
});
