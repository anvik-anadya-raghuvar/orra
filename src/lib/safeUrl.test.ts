import { describe, expect, it } from 'vitest';
import { safeHref } from './safeUrl';

describe('safeHref', () => {
  it('adds https to a bare host', () => {
    expect(safeHref('anvik.club')).toBe('https://anvik.club');
    expect(safeHref('  example.com:8080/x ')).toBe('https://example.com:8080/x');
  });

  it('keeps http, https and mailto links as typed', () => {
    expect(safeHref('http://a.test/p')).toBe('http://a.test/p');
    expect(safeHref('https://drive.google.com/file/d/1')).toBe('https://drive.google.com/file/d/1');
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test');
  });

  it('refuses scripts, data and other schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull();
    expect(safeHref('vbscript:x')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });

  it('returns null for nothing at all', () => {
    expect(safeHref('')).toBeNull();
    expect(safeHref('   ')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});
