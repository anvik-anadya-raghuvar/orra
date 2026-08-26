/**
 * The "@ tag" control that drops a person token into whatever is being typed.
 *
 * Goes through `createTextFormatting` rather than setting state directly, for
 * the same reason every toolbar button does: the insert lands as a native
 * edit, so Ctrl+Z after tagging someone undoes the tag instead of jumping
 * over it to whatever you typed before.
 *
 * A `<select>` rather than an @-triggered autocomplete because there are two
 * people. A popup that filters a list of two is a worse version of a list of
 * two.
 */
import type { RefObject } from 'react';
import { useStore } from '../data/store';
import { mentionToken } from '../lib/mentions';
import { createTextFormatting } from './textFormatting';
import './mentionPicker.css';

export function MentionPicker({
  textarea,
  value,
  onValue,
  label = 'Tag someone',
}: {
  textarea: RefObject<HTMLTextAreaElement>;
  value: string;
  onValue: (value: string, selectionStart: number, selectionEnd: number) => void;
  label?: string;
}) {
  const store = useStore();
  return (
    <select
      className="mention-pick"
      aria-label={label}
      value=""
      onChange={(event) => {
        const person = store.members.find((member) => member.id === event.target.value);
        if (person) {
          createTextFormatting(textarea, value, onValue).insert(mentionToken(person.id, person.name));
        }
      }}
    >
      <option value="">@ tag</option>
      {store.members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </select>
  );
}
