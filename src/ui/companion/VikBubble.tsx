/**
 * The speech bubble and its controls.
 *
 * Two kinds of text share it: an announcement from the pure engine, which may
 * carry an action and can be snoozed, and a one-off quip from play, which
 * carries nothing. Only the former gets buttons — a huffy "Hmph." with a
 * dismiss control beside it reads as a dialog box, not a sulk.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { Moment } from '../../lib/companion';
import { entrance, micro } from '../motion';
import type { BubbleHoverProps } from './useBubbleLife';

interface Props {
  text: string | null;
  /** The live announcement, if the text came from one. */
  moment: Moment | null;
  /** Ambient chatter can be snoozed; a reply to a poke cannot. */
  snoozable: boolean;
  robotName: string;
  animate: boolean;
  dismiss: () => void;
  snooze: () => void;
  hoverProps: BubbleHoverProps;
}

export default function VikBubble({
  text,
  moment,
  snoozable,
  robotName,
  animate,
  dismiss,
  snooze,
  hoverProps,
}: Props) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          className="vik-bubble"
          role="status"
          aria-live="polite"
          initial={animate ? { opacity: 0, y: 8, scale: 0.92 } : false}
          animate={{ opacity: 1, y: 0, scale: 1, transition: entrance }}
          exit={
            animate
              ? { opacity: 0, y: 6, transition: micro }
              : { opacity: 0, transition: { duration: 0 } }
          }
          {...hoverProps}
        >
          <span>{text}</span>
          {moment && (
            <div className="vik-actions">
              {moment.action?.to && (
                <Link className="chip go" to={moment.action.to} onClick={dismiss}>
                  {moment.action.label}
                </Link>
              )}
              {moment.action?.url && (
                <a
                  className="chip go"
                  href={moment.action.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={dismiss}
                >
                  {moment.action.label}
                </a>
              )}
              {snoozable && (
                <button
                  className="vik-iconbtn"
                  aria-label={`Snooze ${robotName} for four hours`}
                  title="Snooze for 4 hours"
                  onClick={snooze}
                >
                  zZ
                </button>
              )}
              <button className="vik-iconbtn" aria-label="Dismiss" onClick={dismiss}>
                ✕
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
