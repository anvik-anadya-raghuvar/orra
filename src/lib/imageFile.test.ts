import { describe, expect, it } from 'vitest';
import {
  dataUrlToBytes,
  downloadName,
  extensionForMime,
  mimeFromDataUrl,
  needsPngForClipboard,
} from './imageFile';

// "hi" in base64 — small enough to assert byte for byte.
const HI = 'data:image/png;base64,aGk=';

describe('mimeFromDataUrl', () => {
  it('reads the declared type', () => {
    expect(mimeFromDataUrl(HI)).toBe('image/png');
    expect(mimeFromDataUrl('data:image/JPEG;base64,xx')).toBe('image/jpeg');
  });

  it('falls back to png rather than guessing, for junk or nothing', () => {
    expect(mimeFromDataUrl('not a data url')).toBe('image/png');
    expect(mimeFromDataUrl('')).toBe('image/png');
  });
});

describe('extensionForMime', () => {
  it('maps the types this app actually stores', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });

  it('defaults to png for anything unknown', () => {
    expect(extensionForMime('application/pdf')).toBe('png');
  });
});

describe('downloadName', () => {
  it('corrects an extension that lies about the bytes', () => {
    // Screenshots are compressed to JPEG but often keep a .png name; saving
    // that as .png produces a file the OS refuses to open.
    expect(downloadName('screen.png', 'image/jpeg')).toBe('screen.jpg');
  });

  it('keeps a name that is already right', () => {
    expect(downloadName('card.jpg', 'image/jpeg')).toBe('card.jpg');
  });

  it('strips what Windows refuses, keeps what is legal', () => {
    // Spaces and dashes survive: both are legal everywhere, and removing them
    // makes the saved file harder to recognise, not safer.
    expect(downloadName('before/after: v2.png', 'image/png')).toBe('before-after v2.png');
  });

  it('drops control characters without eating punctuation around them', () => {
    expect(downloadName('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(31) + 'c.png', 'image/png')).toBe('abc.png');
  });

  it('adds an extension when there is none', () => {
    expect(downloadName('scan', 'image/png')).toBe('scan.png');
  });

  it('falls back to a usable name when nothing survives cleaning', () => {
    expect(downloadName('', 'image/png')).toBe('image.png');
    expect(downloadName('///', 'image/jpeg')).toBe('image.jpg');
    expect(downloadName('  -  ', 'image/png')).toBe('image.png');
    expect(downloadName('...', 'image/png')).toBe('image.png');
  });
});

describe('dataUrlToBytes', () => {
  it('decodes base64 payloads', () => {
    const out = dataUrlToBytes(HI)!;
    expect(out.mime).toBe('image/png');
    expect([...out.bytes]).toEqual([104, 105]); // 'h', 'i'
  });

  it('defaults the mime when the URL omits it', () => {
    expect(dataUrlToBytes('data:;base64,aGk=')!.mime).toBe('image/png');
  });

  it('returns null instead of throwing for anything unusable', () => {
    // These run inside click handlers: a broken image should disable a
    // button, not take the page down.
    expect(dataUrlToBytes('https://example.com/a.png')).toBeNull();
    expect(dataUrlToBytes('data:image/png,notbase64')).toBeNull();
    expect(dataUrlToBytes('')).toBeNull();
  });
});

describe('needsPngForClipboard', () => {
  it('passes PNG through and converts everything else', () => {
    expect(needsPngForClipboard('image/png')).toBe(false);
    expect(needsPngForClipboard('image/jpeg')).toBe(true);
    expect(needsPngForClipboard('image/webp')).toBe(true);
  });
});
