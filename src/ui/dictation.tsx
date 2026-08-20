import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import {
  DICTATION_LANGUAGES,
  describeSpeechError,
  isDictatable,
  isFatalSpeechError,
  joinDictation,
  loadDictationLanguage,
  saveDictationLanguage,
  setFieldValue,
  speechRecognitionCtor,
  speechSupported,
  spliceDictation,
  type SpeechRecognitionLike,
} from '../lib/speech';
import { useToast } from './bits';
import { entrance, micro } from './motion';
import './dictation.css';

/* ── Dictation, everywhere there is a cursor ───────────────────────────────
   One recognition engine for the whole portal, not one per composer. The
   browser only reliably runs a single SpeechRecognition at a time, and a mic
   that is "on" in two places at once is a bug you cannot reason about, so the
   engine is a singleton held here and pointed at whichever field is being
   spoken into.

   Because it writes through the field's DOM value setter (see setFieldValue),
   it does not need to know anything about the field it is typing into. Drop a
   <MicButton /> next to any input or textarea in the app — controlled,
   uncontrolled, inside a modal, one of several in a split editor — and it
   works with no other wiring. The keyboard shortcut covers everything with no
   button at all.
   ────────────────────────────────────────────────────────────────────────── */

type Field = HTMLInputElement | HTMLTextAreaElement;

interface DictationValue {
  supported: boolean;
  listening: boolean;
  /** The field being dictated into right now, for per-button active state. */
  target: Field | null;
  language: string;
  setLanguage: (code: string) => void;
  start: (field: Field) => void;
  stop: () => void;
  toggle: (field: Field) => void;
  /** Most recent field the user focused — the default dictation target. */
  lastFocused: () => Field | null;
}

const DictationCtx = createContext<DictationValue | null>(null);

export function useDictation(): DictationValue {
  const ctx = useContext(DictationCtx);
  if (!ctx) throw new Error('useDictation must be used inside <DictationProvider>');
  return ctx;
}

/* A restart storm means something is wrong that retrying will not fix — a
   codec the browser cannot open, a device yanked mid-sentence. Bounded so a
   broken microphone cannot spin the tab. */
const MAX_RESTARTS = 8;
const RESTART_WINDOW_MS = 10_000;

export function DictationProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const supported = useMemo(() => speechSupported(), []);
  const [listening, setListening] = useState(false);
  const [target, setTarget] = useState<Field | null>(null);
  const [language, setLanguageState] = useState<string>(() =>
    supported ? loadDictationLanguage() : 'en-IN',
  );

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const fieldRef = useRef<Field | null>(null);
  /** Text either side of the caret when dictation started. Never moves while
      a phrase is being redrawn, which is what makes an interim result replace
      the previous one instead of stacking on top of it. */
  const anchor = useRef<{ before: string; after: string }>({ before: '', after: '' });
  /** Everything the recogniser has committed since the anchor was set. */
  const finalText = useRef('');
  /** The last string we wrote, so a change we did not write reads as typing. */
  const lastEmitted = useRef<string | null>(null);
  const wantListening = useRef(false);
  const restarts = useRef<number[]>([]);
  const lastFocusedField = useRef<Field | null>(null);
  const languageRef = useRef(language);
  languageRef.current = language;

  /* ── Which field is the default target ─────────────────────────────────
     Tracked at the document level so a mic button never has to be handed a
     ref, and so the keyboard shortcut works on a field nobody wired up. */
  useEffect(() => {
    if (!supported) return;
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as Element | null;
      if (isDictatable(el)) lastFocusedField.current = el;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [supported]);

  /** Re-read the caret and treat whatever is there now as the new starting
      point. Called when dictation begins, and again whenever the person types
      into the field mid-phrase so their edit is not overwritten. */
  const reanchor = useCallback((el: Field) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    anchor.current = { before: el.value.slice(0, start), after: el.value.slice(end) };
    finalText.current = '';
    lastEmitted.current = el.value;
  }, []);

  const teardown = useCallback(() => {
    const engine = recognition.current;
    if (!engine) return;
    engine.onresult = null;
    engine.onerror = null;
    engine.onend = null;
    engine.onstart = null;
    engine.onspeechstart = null;
    try {
      engine.abort();
    } catch {
      /* already dead */
    }
    recognition.current = null;
  }, []);

  const stop = useCallback(() => {
    wantListening.current = false;
    teardown();
    setListening(false);
    setTarget(null);
    fieldRef.current = null;
    restarts.current = [];
  }, [teardown]);

  /** Redraw the field from the anchor plus everything heard so far. */
  const paint = useCallback((interim: string) => {
    const el = fieldRef.current;
    if (!el || !el.isConnected) return;
    const spoken = interim.trim()
      ? finalText.current + joinDictation(finalText.current, interim)
      : finalText.current;
    const { value, caret } = spliceDictation(anchor.current.before, anchor.current.after, spoken);
    // Set this BEFORE writing: setFieldValue dispatches `input` synchronously,
    // and the typing detector below must recognise the echo as our own.
    lastEmitted.current = value;
    setFieldValue(el, value, caret);
  }, []);

  const begin = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    const el = fieldRef.current;
    if (!Ctor || !el) return;
    teardown();
    const engine = new Ctor();
    engine.lang = languageRef.current;
    engine.continuous = true;
    engine.interimResults = true;
    engine.maxAlternatives = 1;

    engine.onresult = (event) => {
      let committed = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) committed += text;
        else interim += text;
      }
      if (committed.trim()) {
        finalText.current += joinDictation(finalText.current, committed);
      }
      paint(interim);
    };

    engine.onerror = (event) => {
      const code = event.error;
      // Silence and a deliberate abort are ordinary: `onend` restarts or ends
      // the session, and saying so out loud every few seconds would be noise.
      if (code === 'no-speech' || code === 'aborted') return;
      toast(describeSpeechError(code));
      // A blocked or missing microphone will not fix itself on retry, so end
      // the session rather than letting onend restart into the same wall.
      if (isFatalSpeechError(code)) stop();
    };

    engine.onend = () => {
      if (!wantListening.current) {
        setListening(false);
        return;
      }
      // Chrome ends the session after a pause even in continuous mode. Keep it
      // alive so a thought with a gap in it stays one dictation, but never let
      // that become an unbounded restart loop.
      const now = performance.now();
      restarts.current = restarts.current.filter((t) => now - t < RESTART_WINDOW_MS);
      if (restarts.current.length >= MAX_RESTARTS) {
        toast('Dictation kept dropping out, so it has stopped. Start it again when you are ready.');
        stop();
        return;
      }
      restarts.current.push(now);
      try {
        engine.start();
      } catch {
        stop();
      }
    };

    try {
      engine.start();
      recognition.current = engine;
      setListening(true);
    } catch {
      toast('Dictation could not start. Check that the microphone is free.');
      stop();
    }
  }, [paint, stop, teardown, toast]);

  const start = useCallback(
    (field: Field) => {
      if (!supported || !isDictatable(field)) return;
      fieldRef.current = field;
      setTarget(field);
      reanchor(field);
      wantListening.current = true;
      restarts.current = [];
      begin();
    },
    [begin, reanchor, supported],
  );

  const toggle = useCallback(
    (field: Field) => {
      if (listening && fieldRef.current === field) stop();
      else start(field);
    },
    [listening, start, stop],
  );

  /* ── Typing while dictating ────────────────────────────────────────────
     The person is allowed to fix a word by hand mid-sentence. Any change to
     the field we did not write ourselves resets the anchor to the new caret,
     so the next phrase continues from where they left the cursor rather than
     undoing their edit. */
  useEffect(() => {
    if (!listening) return;
    const el = fieldRef.current;
    if (!el) return;
    const onInput = () => {
      if (el.value === lastEmitted.current) return;
      reanchor(el);
    };
    el.addEventListener('input', onInput);
    return () => el.removeEventListener('input', onInput);
  }, [listening, reanchor]);

  /* Stop when the field goes away, or when the person moves to a different
     one — a mic still running against a field you have left is a trap. */
  useEffect(() => {
    if (!listening) return;
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as Element | null;
      if (!isDictatable(el)) return;
      if (el !== fieldRef.current) stop();
    };
    const check = window.setInterval(() => {
      if (!fieldRef.current?.isConnected) stop();
    }, 1500);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.clearInterval(check);
    };
  }, [listening, stop]);

  /* Escape stops dictation from anywhere; the shortcut starts it on whatever
     field has the cursor, which is how the long tail of small inputs — a
     search box, a tag field, a table cell — gets dictation without a button. */
  useEffect(() => {
    if (!supported) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && wantListening.current) {
        stop();
        return;
      }
      const combo = (event.ctrlKey || event.metaKey) && event.shiftKey;
      if (!combo || event.key.toLowerCase() !== 'd') return;
      const active = document.activeElement;
      const field = isDictatable(active) ? active : lastFocusedField.current;
      if (!field?.isConnected) return;
      event.preventDefault();
      toggle(field);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [stop, supported, toggle]);

  useEffect(() => () => teardown(), [teardown]);

  const setLanguage = useCallback(
    (code: string) => {
      setLanguageState(code);
      saveDictationLanguage(code);
      languageRef.current = code;
      // Mid-sentence language changes restart the engine, keeping the words
      // already committed — the anchor does not move.
      if (wantListening.current && fieldRef.current) begin();
    },
    [begin],
  );

  const value = useMemo<DictationValue>(
    () => ({
      supported,
      listening,
      target,
      language,
      setLanguage,
      start,
      stop,
      toggle,
      lastFocused: () => lastFocusedField.current,
    }),
    [language, listening, setLanguage, start, stop, supported, target, toggle],
  );

  return (
    <DictationCtx.Provider value={value}>
      {children}
      <DictationStatus />
    </DictationCtx.Provider>
  );
}

/* ── The mic ───────────────────────────────────────────────────────────────
   Renders nothing where the browser cannot dictate, rather than a control
   that does nothing when pressed. */
export function MicButton({
  targetRef,
  label = 'Dictate',
  className = '',
  size = 16,
}: {
  /** Optional. Without it the button dictates into the focused field, then
      the nearest text field in its own container. */
  targetRef?: React.RefObject<Field | null>;
  label?: string;
  className?: string;
  size?: number;
}) {
  const { supported, listening, target, toggle } = useDictation();
  const reduced = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The field this particular button last aimed at, so several mics on one
      screen can each show whether it is *their* field that is live. */
  const myField = useRef<Field | null>(null);

  if (!supported) return null;

  /**
   * Which field do the words go into?
   *
   * An explicit ref wins. Otherwise the focused field, which is the normal
   * case — you click into a box and reach for the mic. Failing that, widen out
   * from the button one ancestor at a time until a text field turns up, so a
   * mic placed in a toolbar above its editor still finds the editor before you
   * have clicked anything at all.
   *
   * Within a scope, a field AFTER the button wins over one before it. Document
   * order alone is not good enough: a mic sitting above a body editor shares a
   * container with the title field above it, and "first match" sent the words
   * to the title.
   */
  const resolve = (): Field | null => {
    if (targetRef?.current) return targetRef.current;
    const active = document.activeElement;
    if (isDictatable(active)) return active;
    const button = buttonRef.current;
    if (!button) return null;
    const selector = 'textarea, input[type="text"], input[type="search"], input:not([type])';
    let scope: HTMLElement | null = button.parentElement;
    for (let depth = 0; scope && depth < 6; depth += 1) {
      const fields = Array.from(scope.querySelectorAll(selector)).filter(isDictatable);
      if (fields.length) {
        const after = fields.find(
          (field) =>
            (button.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        );
        return after ?? fields[fields.length - 1];
      }
      scope = scope.parentElement;
    }
    return null;
  };

  const isOn = listening && target !== null && target === (targetRef?.current ?? myField.current);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`micbtn ${isOn ? 'on' : ''} ${className}`.trim()}
      aria-pressed={isOn}
      // `label` is the whole accessible name, not a fragment to decorate —
      // appending to it produced "Capture by voice by voice".
      aria-label={isOn ? 'Stop dictating' : label}
      title={isOn ? 'Stop dictating (Esc)' : 'Dictate — speak and it types what you say'}
      // Keep the caret where it is: a click that blurs the field would lose the
      // insertion point the words are meant to land on.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const field = resolve();
        if (!field) return;
        myField.current = field;
        field.focus();
        toggle(field);
      }}
    >
      {isOn ? (
        <>
          <Square size={size - 4} strokeWidth={2.4} aria-hidden />
          {!reduced && <span className="micpulse" aria-hidden />}
        </>
      ) : (
        <Mic size={size} strokeWidth={1.9} aria-hidden />
      )}
    </button>
  );
}

/* ── A field with a mic in it ──────────────────────────────────────────────
   The mic sits inside the field rather than on a row above it, which is the
   difference between adding dictation to thirty forms and making thirty forms
   taller. It is absolutely placed, so it costs no vertical space, and the
   field is given room on the right so text never runs underneath it.

   Wrap any single input or textarea:

       <DictateField><textarea value={x} onChange={…} /></DictateField>

   Nothing else changes — no ref, no state, no handler. Where the browser
   cannot dictate, the child is returned untouched and un-padded.
   ────────────────────────────────────────────────────────────────────────── */
export function DictateField({
  children,
  label = 'Dictate',
  className = '',
}: {
  children: React.ReactElement;
  label?: string;
  className?: string;
}) {
  const { supported } = useDictation();
  if (!supported) return children;

  const props = children.props as { style?: React.CSSProperties };
  const isArea = children.type === 'textarea';
  const padded = React.cloneElement(children as React.ReactElement<{ style?: React.CSSProperties }>, {
    style: { ...props.style, paddingRight: 46 },
  });

  return (
    <div className={`dictate-wrap ${isArea ? 'area' : 'line'} ${className}`.trim()}>
      {padded}
      <MicButton className="in-field" label={label} />
    </div>
  );
}

/* ── Status ────────────────────────────────────────────────────────────────
   Dictation is a mode, and a mode with no visible indicator is how a hot mic
   gets left running. One pill, always in the same place, with the stop
   control and the language on it. */
function DictationStatus() {
  const { listening, language, setLanguage, stop } = useDictation();
  const reduced = useReducedMotion();

  return createPortal(
    <>
      <div className="dictation-sr" role="status" aria-live="polite">
        {listening ? 'Listening. Speak, and it will type what you say.' : ''}
      </div>
      <AnimatePresence>
        {listening && (
          <motion.div
            className="dictation-pill"
            // The x here is not decoration: Framer writes `transform` inline,
            // which would drop the stylesheet's translateX(-50%) and leave the
            // pill hanging off the right edge on a narrow screen. Centring has
            // to be part of every variant, exactly as the toast does it.
            initial={reduced ? { opacity: 1, x: '-50%' } : { opacity: 0, y: 14, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={reduced ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 10, x: '-50%', transition: micro }}
            transition={entrance}
          >
            <span className="dictation-live" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="dictation-word">Listening</span>
            <select
              aria-label="Dictation language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {DICTATION_LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={stop}>
              Stop
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
