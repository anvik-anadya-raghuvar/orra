import { describe, expect, it } from 'vitest';
import { typeLabel } from './common';

describe('typeLabel', () => {
  it('humanizes a stored value into what a person typed', () => {
    // task type is free text (0035_free_project_and_type.sql) — there is no
    // lookup table any more, so this just formats whatever string is stored
    expect(typeLabel('code_change')).toBe('Code Change');
    expect(typeLabel('ops')).toBe('Ops');
  });

  it('leaves an already-readable custom type alone', () => {
    expect(typeLabel('Client call')).toBe('Client Call');
    expect(typeLabel('vendor-negotiation')).toBe('Vendor-Negotiation');
  });

  it('does not throw on an empty type', () => {
    expect(typeLabel('')).toBe('');
  });
});
