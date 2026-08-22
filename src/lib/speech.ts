/* ── Dictation ─────────────────────────────────────────────────────────────
   Speak, and it types exactly what you said.

   The engine is the browser's own Web Speech API. That choice is deliberate
   and load-bearing: it is the only speech-to-text that costs nothing per
   minute, needs no key, and sends no audio to a server we pay for. Whisper
   behind an edge function would be more accurate and would also be the first
   line item on a ₹0 bill, so it is not used.

   What this module holds is the part worth testing — where spoken words land
   in a string, and how the field is told about it. The recognition lifecycle
   (start, restart, permission, teardown) lives in ui/dictation.tsx, because it
   is stateful and belongs to a React tree.

   One rule runs through all of it: the transcript is inserted VERBATIM. No
   spoken-punctuation commands ("full stop" stays the words "full stop"), no
   capitalisation, no tidying. The ask was exactly what was said, and a
   dictation tool that silently edits is one you can never fully trust.
   ────────────────────────────────────────────────────────────────────────── */

/* ── Minimal typings ───────────────────────────────────────────────────────
   SpeechRecognition is still not in lib.dom.d.ts — it has never left the
   incubator spec — so the shape we actually use is declared here rather than
   pulling in a dependency for four interfaces. */

export interface SpeechAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechAlternative;
}

export interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}

export interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}

export interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The constructor, prefixed or not, or null where the browser has none. */
export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Can this browser dictate at all?
 *
 * Chrome, Edge and Safari can; Firefox cannot, and a mic button that does
 * nothing there is worse than no mic button. Every surface checks this and
 * renders nothing rather than a dead control.
 */
export function speechSupported(): boolean {
  return speechRecognitionCtor() !== null;
}

/* ── Language ──────────────────────────────────────────────────────────────
   Two people, two countries, and English spoken with an Indian accent is
   recognised measurably worse under en-US than under en-IN. So the language
   is a visible, sticky choice rather than a guess made once from
   navigator.language and never revisited. */

export interface DictationLanguage {
  code: string;
  label: string;
}

export const DICTATION_LANGUAGES: DictationLanguage[] = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'hi-IN', label: 'Hindi' },
];

const LANGUAGE_KEY = 'orra:dictation-lang';

/** The best default for a browser we know nothing else about. */
export function defaultDictationLanguage(navigatorLanguage?: string): string {
  const tag = (navigatorLanguage ?? '').toLowerCase();
  if (!tag) return 'en-IN';
  const exact = DICTATION_LANGUAGES.find((l) => l.code.toLowerCase() === tag);
  if (exact) return exact.code;
  const base = tag.split('-')[0];
  const sameBase = DICTATION_LANGUAGES.find((l) => l.code.toLowerCase().startsWith(`${base}-`));
  return sameBase ? sameBase.code : 'en-IN';
}

export function loadDictationLanguage(): string {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    if (stored && DICTATION_LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch {
    /* private mode, or storage disabled — fall through to the default */
  }
  return defaultDictationLanguage(typeof navigator === 'undefined' ? '' : navigator.language);
}

export function saveDictationLanguage(code: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    /* failing to remember the choice is not worth an error */
  }
}

/* ── Where the words land ──────────────────────────────────────────────────
   Dictation happens at a caret inside text that may already exist on both
   sides of it. These two functions are the whole of that arithmetic, kept
   pure so the spacing rules can be pinned down by test rather than by
   squinting at a live microphone. */

/** Characters after which a new word needs no space in front of it. */
const OPENERS = new Set(['(', '[', '{', '"', '“', '‘', "'", '—', '-', '/']);

/** Characters before which a preceding word needs no space behind it. */
const CLOSERS = new Set([
  '.', ',', ';', ':', '!', '?', ')', ']', '}', '"', '”', '’', "'", '—', '-', '/',
]);

/**
 * The spoken text, spaced to sit correctly after `before`.
 *
 * The transcript itself is untouched — only the whitespace around it is
 * decided here. Recognisers return a leading space inconsistently, so it is
 * trimmed and re-derived rather than trusted.
 */
export function joinDictation(before: string, spoken: string): string {
  const text = spoken.trim();
  if (!text) return '';
  if (!before) return text;
  const last = before[before.length - 1];
  if (/\s/.test(last) || OPENERS.has(last)) return text;
  return ` ${text}`;
}

export interface DictationSplice {
  value: string;
  caret: number;
}

/**
 * Put `spoken` between `before` and `after`, and say where the caret ends up.
 *
 * A trailing space is added only when dictating into the middle of a line and
 * the next character starts a real word — so speaking into a gap does not weld
 * two words together, while speaking in front of a comma does not push that
 * comma off its word.
 */
export function spliceDictation(before: string, after: string, spoken: string): DictationSplice {
  const middle = joinDictation(before, spoken);
  if (!middle) return { value: before + after, caret: before.length };
  const first = after[0];
  const needsTrailingSpace = after.length > 0 && !/\s/.test(first) && !CLOSERS.has(first);
  const value = before + middle + (needsTrailingSpace ? ' ' : '') + after;
  return { value, caret: before.length + middle.length };
}

/* ── Talking to a React-controlled field ───────────────────────────────────
   Every text field in this portal is controlled, and assigning `el.value`
   directly is invisible to React — its own value tracker sees no change and
   swallows the input event, so the next render puts the old string back.

   Going through the prototype setter defeats that tracker, which is what lets
   ONE dictation engine write into ANY field in the app without every call site
   having to hand it a setState. That is the difference between dictation at
   eight composers and dictation anywhere there is a cursor. */
export function setFieldValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  caret: number,
): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* number and date inputs refuse a selection range; harmless here */
  }
}

/** Field types it makes sense to speak into. */
const DICTATABLE_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);

/** Is this element something dictation can sensibly type into? */
export function isDictatable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.disabled && !el.readOnly && DICTATABLE_INPUT_TYPES.has(el.type);
  }
  return false;
}

/* ── Errors ────────────────────────────────────────────────────────────────
   Spoken into a microphone that is muted, blocked or absent, the API fails
   with a terse code. These are the ones a person can actually act on. */

/** True when the failure is permanent for this page, so retrying is pointless. */
export function isFatalSpeechError(code: string): boolean {
  return code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture';
}

export function describeSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The browser blocked the microphone. Allow it for this site, then start again.';
    case 'audio-capture':
      return 'No microphone was found. Plug one in, or pick one in your system settings.';
    case 'network':
      return 'Speech recognition needs the network and could not reach it. Check your connection.';
    case 'no-speech':
      return 'Nothing was heard. Try again, a little closer to the microphone.';
    case 'aborted':
      return 'Dictation stopped.';
    default:
      return 'Dictation stopped unexpectedly. Start it again to carry on.';
  }
}
