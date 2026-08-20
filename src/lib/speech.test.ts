import { describe, expect, it } from 'vitest';
import {
  DICTATION_LANGUAGES,
  defaultDictationLanguage,
  describeSpeechError,
  isFatalSpeechError,
  joinDictation,
  spliceDictation,
} from './speech';

describe('joinDictation — spacing in front of the words', () => {
  it('adds nothing in an empty field', () => {
    expect(joinDictation('', 'ship the invoice')).toBe('ship the invoice');
  });

  it('adds one space after a word', () => {
    expect(joinDictation('remember to', 'call the bank')).toBe(' call the bank');
  });

  it('does not double a space that is already there', () => {
    expect(joinDictation('remember to ', 'call the bank')).toBe('call the bank');
    expect(joinDictation('a line\n', 'next line')).toBe('next line');
  });

  it('does not push a word off an opening bracket or quote', () => {
    expect(joinDictation('a note (', 'draft only')).toBe('draft only');
    expect(joinDictation('he said "', 'no')).toBe('no');
  });

  it('trims the leading space recognisers add, without touching the words', () => {
    expect(joinDictation('', '  ship the invoice  ')).toBe('ship the invoice');
  });

  it('is verbatim — spoken punctuation stays as words, case is untouched', () => {
    expect(joinDictation('', 'full stop new line Comma')).toBe('full stop new line Comma');
    expect(joinDictation('', 'iPhone and BMW')).toBe('iPhone and BMW');
  });

  it('contributes nothing for silence', () => {
    expect(joinDictation('anything', '   ')).toBe('');
  });
});

describe('spliceDictation — where the words land and where the caret ends up', () => {
  it('appends at the end of a field', () => {
    expect(spliceDictation('Buy milk', '', 'and eggs')).toEqual({
      value: 'Buy milk and eggs',
      caret: 'Buy milk and eggs'.length,
    });
  });

  it('inserts mid-line without welding two words together', () => {
    expect(spliceDictation('Buy ', 'today', 'milk')).toEqual({
      value: 'Buy milk today',
      caret: 'Buy milk'.length,
    });
  });

  it('does not push punctuation off the word in front of it', () => {
    expect(spliceDictation('Buy ', ', please', 'milk')).toEqual({
      value: 'Buy milk, please',
      caret: 'Buy milk'.length,
    });
  });

  it('leaves the value untouched when nothing was heard', () => {
    expect(spliceDictation('Buy ', 'today', '  ')).toEqual({ value: 'Buy today', caret: 4 });
  });

  it('puts the caret after the words so typing carries on from there', () => {
    const result = spliceDictation('one', ' three', 'two');
    expect(result.value).toBe('one two three');
    expect(result.value.slice(0, result.caret)).toBe('one two');
  });

  it('is idempotent in shape — re-splicing a live interim replaces, never stacks', () => {
    // This is how the hook redraws an interim result: the anchor never moves,
    // so a longer transcript overwrites the shorter one rather than appending.
    const first = spliceDictation('Note: ', '', 'the quarter');
    const second = spliceDictation('Note: ', '', 'the quarterly report');
    expect(first.value).toBe('Note: the quarter');
    expect(second.value).toBe('Note: the quarterly report');
  });
});

describe('language choice', () => {
  it('keeps an exact match', () => {
    expect(defaultDictationLanguage('it-IT')).toBe('it-IT');
    expect(defaultDictationLanguage('EN-gb')).toBe('en-GB');
  });

  it('falls back to the same language in another region', () => {
    expect(defaultDictationLanguage('it-CH')).toBe('it-IT');
  });

  it('defaults to Indian English when the tag is unknown or absent', () => {
    expect(defaultDictationLanguage('fr-FR')).toBe('en-IN');
    expect(defaultDictationLanguage('')).toBe('en-IN');
    expect(defaultDictationLanguage(undefined)).toBe('en-IN');
  });

  it('offers both countries this portal is run from', () => {
    const codes = DICTATION_LANGUAGES.map((l) => l.code);
    expect(codes).toContain('en-IN');
    expect(codes).toContain('it-IT');
  });
});

describe('errors', () => {
  it('treats permission and hardware failures as fatal, and silence as retryable', () => {
    expect(isFatalSpeechError('not-allowed')).toBe(true);
    expect(isFatalSpeechError('service-not-allowed')).toBe(true);
    expect(isFatalSpeechError('audio-capture')).toBe(true);
    expect(isFatalSpeechError('no-speech')).toBe(false);
    expect(isFatalSpeechError('network')).toBe(false);
  });

  it('explains every code as a sentence, never by showing the raw code', () => {
    for (const code of ['not-allowed', 'audio-capture', 'network', 'no-speech', 'aborted', 'weird']) {
      const message = describeSpeechError(code);
      expect(message.length).toBeGreaterThan(10);
      // A hyphenated API code is the tell that raw machinery reached the user.
      expect(message).not.toMatch(/[a-z]+-[a-z]+/);
    }
  });
});
