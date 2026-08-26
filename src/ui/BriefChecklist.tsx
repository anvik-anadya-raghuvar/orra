/**
 * The tick boxes written into a brief, pulled out where they can be clicked.
 *
 * The description is a `<textarea>` — you cannot click a checkbox inside one,
 * and turning it into a read-when-idle / edit-when-focused surface would cost
 * the inline images and pins that already live in that editor. So the boxes
 * are mirrored here, directly under the text they came from. There is still
 * exactly one copy of the data: the description string. Ticking rewrites that
 * string, the textarea above re-renders with `- [x]`, and this strip is
 * derived again from it.
 *
 * Read-only without `onToggle` — the new-task sheet shows the steps it is
 * about to create, and there is no row to write to yet.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { readChecklist } from '../lib/checklist';
import { ProgressBar } from './bits';
import { staggerItem, staggerParent } from './motion';
import { RichText } from './richText';
import './richText.css';

export function BriefChecklist({
  text,
  onToggle,
  label = 'In the brief',
}: {
  text: string;
  onToggle?: (line: number) => void;
  label?: string;
}) {
  const items = readChecklist(text);
  if (!items.length) return null;

  const done = items.filter((item) => item.done).length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div className="brief-checks">
      <div className="brief-checks-head">
        <span className="mono">{label}</span>
        <span className="mono">{done}/{items.length} done · {pct}%</span>
      </div>
      <ProgressBar pct={pct} grad="linear-gradient(90deg,var(--teal),var(--sky))" />
      <motion.ul className="rt-checks" {...staggerParent()}>
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li key={item.line} variants={staggerItem} layout>
              <button
                type="button"
                className="rt-check"
                aria-pressed={item.done}
                disabled={!onToggle}
                onClick={() => onToggle?.(item.line)}
              >
                <span className={`rt-box${item.done ? ' on' : ''}`} aria-hidden />
                <span className={item.done ? 'rt-struck' : undefined}>
                  {item.label ? <RichText text={item.label} /> : <em className="mute">(unnamed step)</em>}
                </span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>
    </div>
  );
}
