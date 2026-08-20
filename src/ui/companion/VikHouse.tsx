/**
 * Vik's house.
 *
 * The window is the friendliness meter. It is the only part of the meter
 * that is always on screen, and it is deliberately a light rather than a bar:
 * cold and dim when he is sulking, warm and full when he is delighted. You
 * read it the way you read a lit window from the street, not the way you read
 * a progress indicator you are failing to fill.
 *
 * The mailbox flag goes up when a note arrived while you were unreachable.
 * Tapping the house opens his status panel.
 *
 * Everything except the chimney smoke is a state change rather than an
 * animation, so this degrades to a perfectly correct still image under reduced
 * motion without a single special case.
 */
import { motion } from 'framer-motion';
import type { HouseState } from '../../lib/companionHouse';
import type { Band } from '../../lib/companionMood';

interface Props {
  state: HouseState;
  band: Band;
  /** 0..1 — how warm the window glows. */
  glow: number;
  robotName: string;
  animate: boolean;
  onOpen: () => void;
}

export default function VikHouse({ state, band, glow, robotName, animate, onOpen }: Props) {
  const label = state.mailbox
    ? `${robotName}'s place — a note is waiting`
    : `${robotName}'s place`;

  return (
    <button className="vik-house-btn" aria-label={label} title={label} onClick={onOpen}>
      <svg viewBox="0 0 52 46" width="52" height="46" aria-hidden className="vik-house-svg">
        {/* chimney, behind the roof line */}
        <rect x="36" y="6" width="6" height="10" rx="1.5" className="vik-house-chimney" />
        {state.smoke && (
          <motion.g className="vik-smoke" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={i}
                cx="39"
                cy="4"
                r="1.8"
                initial={{ opacity: 0, y: 0, scale: 0.6 }}
                animate={{ opacity: [0, 0.5, 0], y: -9, scale: 1.3 }}
                transition={{ duration: 2.6, delay: i * 0.8, repeat: Infinity }}
              />
            ))}
          </motion.g>
        )}

        {/* roof */}
        <polygon points="26,7 50,20 2,20" className="vik-house-roof" />
        {/* walls */}
        <rect x="7" y="20" width="38" height="22" rx="2" className="vik-house-wall" />

        {/* the window — the meter */}
        <g className="vik-house-window" data-band={band} data-lit={state.lit ? '1' : '0'}>
          <rect x="12" y="24" width="12" height="11" rx="1.6" className="vik-house-glass" />
          {state.lit && (
            <rect
              x="12"
              y="24"
              width="12"
              height="11"
              rx="1.6"
              className="vik-house-glow"
              // The light is the reading: opacity carries the whole meter. A
              // plain opacity change, so CSS transitions it rather than a
              // motion component.
              //
              // The transition is switched off outright when animation is not
              // allowed. A hidden tab does not advance transitions, so the
              // window would otherwise sit frozen part-way between two
              // readings and show a number that was never true — the exact
              // failure useAnimateIn exists to prevent.
              style={{
                opacity: 0.22 + glow * 0.78,
                transition: animate ? undefined : 'none',
              }}
            />
          )}
          <path d="M18,24 L18,35 M12,29.5 L24,29.5" className="vik-house-mullion" />
        </g>

        {/* door — shut, ajar, or open */}
        <g className="vik-house-door" data-door={state.door}>
          <rect x="30" y="27" width="11" height="15" rx="1.4" className="vik-house-doorway" />
          {state.door !== 'open' && (
            <motion.rect
              x="30"
              y="27"
              width="11"
              height="15"
              rx="1.4"
              className="vik-house-leaf"
              style={{ transformBox: 'fill-box', transformOrigin: '0% 50%' }}
              animate={{ scaleX: state.door === 'ajar' ? 0.55 : 1 }}
              transition={animate ? { duration: 0.3 } : { duration: 0 }}
            />
          )}
          <circle cx="38.6" cy="34.5" r="0.9" className="vik-house-knob" />
        </g>

        {/* mailbox — flag up means something is waiting */}
        <g className="vik-house-post">
          <path d="M48,42 L48,33" className="vik-house-postleg" />
          <rect x="44" y="28" width="8" height="5.5" rx="1.4" className="vik-house-box" />
          {state.mailbox && (
            <motion.path
              d="M44,28 L44,22.5"
              className="vik-house-flag"
              initial={animate ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3 }}
            />
          )}
        </g>
      </svg>
    </button>
  );
}
