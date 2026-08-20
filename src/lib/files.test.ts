import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_MOCK_FILE_BYTES,
  fileKind,
  humanBytes,
  rejectReason,
  safeStorageName,
} from './files';

describe('humanBytes', () => {
  it('reads like a file manager, not a number', () => {
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2 KB');
    expect(humanBytes(1_400_000)).toBe('1.3 MB');
    expect(humanBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
  it('does not invent a size for nonsense', () => {
    expect(humanBytes(Number.NaN)).toBe('—');
    expect(humanBytes(-1)).toBe('—');
  });
});

describe('fileKind', () => {
  it('names the formats this pair actually exchanges', () => {
    expect(fileKind('visa-appointment.pdf')).toBe('PDF');
    expect(fileKind('fees.xlsx')).toBe('SHEET');
    expect(fileKind('statement.csv')).toBe('CSV');
    expect(fileKind('contract.docx')).toBe('DOC');
  });
  it('falls back to the MIME type when there is no extension', () => {
    expect(fileKind('scan', 'application/pdf')).toBe('PDF');
    expect(fileKind('clip', 'video/mp4')).toBe('VIDEO');
  });
  it('never returns nothing', () => {
    expect(fileKind('mystery')).toBe('FILE');
    expect(fileKind('thing.weirdext')).toBe('WEIRD');
  });
});

describe('safeStorageName', () => {
  it('cannot smuggle a folder into the path', () => {
    expect(safeStorageName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeStorageName('a/b/c.pdf')).toBe('a_b_c.pdf');
  });
  it('flattens what a storage key will not take', () => {
    expect(safeStorageName('Ricevuta €12 — agosto.pdf')).toBe('Ricevuta_12_agosto.pdf');
  });
  it('always produces something', () => {
    expect(safeStorageName('###')).toBe('file');
    expect(safeStorageName('')).toBe('file');
  });
});

describe('rejectReason', () => {
  it('accepts an ordinary document', () => {
    expect(rejectReason({ name: 'visa.pdf', size: 2_000_000 }, true)).toBeNull();
  });
  it('refuses an empty file', () => {
    expect(rejectReason({ name: 'blank.pdf', size: 0 }, true)).toContain('empty');
  });
  it('refuses above the cap the database also enforces', () => {
    const msg = rejectReason({ name: 'big.zip', size: MAX_FILE_BYTES + 1 }, true);
    expect(msg).toContain('the limit is');
  });
  it('has a much tighter cap in local mode, and says so', () => {
    const msg = rejectReason({ name: 'mid.pdf', size: MAX_MOCK_FILE_BYTES + 1 }, false);
    expect(msg).toContain('in local mode');
    expect(rejectReason({ name: 'mid.pdf', size: MAX_MOCK_FILE_BYTES + 1 }, true)).toBeNull();
  });
});
