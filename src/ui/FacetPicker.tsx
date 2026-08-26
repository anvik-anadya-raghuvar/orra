/**
 * Choosing more than one of something, in one shape.
 *
 * Projects, types and people are three different vocabularies — one is a
 * table you can add rows to, one is free text, one is a fixed list of two —
 * but "which of these does this task belong to" is the same question and
 * deserves the same answer everywhere, or the board and the task page end up
 * teaching two different gestures for the same field.
 *
 * The FIRST chip is the primary: the project whose colour the card takes, the
 * type that decides which panels the task page renders, the person a handoff
 * notice addresses. That is why chips can be promoted rather than only added
 * and removed — reordering is the only way to say "actually, this is mainly a
 * legal task". See lib/taskFacets.ts for what the primary is load-bearing for.
 */
import type { ReactNode } from 'react';
import { ArrowUp, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { staggerItem, staggerParent } from './motion';
import { MAX_FACET } from '../lib/taskFacets';
import './facetPicker.css';

export function FacetChips({
  values,
  label,
  onChange,
  render,
  color,
}: {
  values: string[];
  /** Names the group for screen readers: "projects", "assignees". */
  label: string;
  onChange: (next: string[]) => void;
  render: (value: string) => ReactNode;
  color?: (value: string) => string | undefined;
}) {
  if (!values.length) return <p className="facet-empty">Nothing chosen yet.</p>;

  const move = (value: string) => onChange([value, ...values.filter((v) => v !== value)]);
  const drop = (value: string) => onChange(values.filter((v) => v !== value));

  return (
    <motion.ul className="facet-chips" aria-label={label} {...staggerParent()}>
      <AnimatePresence initial={false}>
        {values.map((value, index) => (
          <motion.li key={value} variants={staggerItem} layout>
            <span className="facet-chip" style={color ? { color: color(value) } : undefined}>
              {index === 0 && <span className="facet-primary" title="Primary — the one the board reads">★</span>}
              <span className="facet-chip-label">{render(value)}</span>
              {index > 0 && (
                <button
                  type="button"
                  className="facet-btn"
                  aria-label={`Make ${value} the primary of these ${label}`}
                  onClick={() => move(value)}
                >
                  <ArrowUp size={13} strokeWidth={2.2} aria-hidden />
                </button>
              )}
              {values.length > 1 && (
                <button
                  type="button"
                  className="facet-btn danger"
                  aria-label={`Remove ${value} from these ${label}`}
                  onClick={() => drop(value)}
                >
                  <X size={13} strokeWidth={2.2} aria-hidden />
                </button>
              )}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

/**
 * The fixed-list variant, for people.
 *
 * A checkbox each rather than chips plus a picker: there are two of them, and
 * a popup that filters a list of two is a worse version of a list of two —
 * the same call MentionPicker makes. Order of first selection decides the
 * primary, so ticking Raghuvar on an unassigned task makes it his.
 */
export function FacetToggles({
  options,
  values,
  label,
  onChange,
}: {
  options: { id: string; name: string }[];
  values: string[];
  label: string;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="facet-toggles" role="group" aria-label={label}>
      {options.map((option) => {
        const index = values.indexOf(option.id);
        const on = index >= 0;
        return (
          <label key={option.id} className={on ? 'on' : undefined}>
            <input
              type="checkbox"
              checked={on}
              disabled={!on && values.length >= MAX_FACET}
              onChange={() =>
                onChange(on ? values.filter((v) => v !== option.id) : [...values, option.id])
              }
            />
            <span>{option.name}</span>
            {index === 0 && <span className="facet-primary" title="Primary — who a handoff notice addresses">★</span>}
          </label>
        );
      })}
    </div>
  );
}
