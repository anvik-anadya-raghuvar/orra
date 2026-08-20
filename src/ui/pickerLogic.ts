/**
 * What a combobox should do when you commit what you typed.
 *
 * Split out from the component so the decision — select an existing row,
 * create a new one, refuse, or clear — is a pure function with tests, rather
 * than something buried in a keydown handler. The component decides *how* to
 * show it; this decides *what it means*.
 *
 * The one rule everything else follows: an exact name match, in any casing,
 * always selects and never creates. That is what stops "Consumer" and
 * "consumer" becoming two projects.
 */

export interface ComboOption {
  id: string;
  label: string;
}

export type ComboCommit =
  /** The typed text matched an option exactly (case-insensitive). */
  | { kind: 'select'; id: string }
  /** Nothing matched — make a new one under this name. */
  | { kind: 'create'; name: string }
  /**
   * The name exists, but not in the list this picker is allowed to show —
   * a personal project seen from a business-only field, say. Creating would
   * silently make a duplicate, so the picker refuses and says why.
   */
  | { kind: 'blocked'; name: string }
  /** Empty input: clear the field, where the field allows that. */
  | { kind: 'none' };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Options whose label contains `text`, case-insensitively.
 *
 * Substring rather than prefix on purpose: these lists are short and
 * human-named, and "gear" should find "Rain gear" without the reader having
 * to remember which word came first.
 */
export function filterOptions(text: string, options: ComboOption[]): ComboOption[] {
  const q = norm(text);
  if (!q) return options;
  return options.filter((o) => o.label.toLowerCase().includes(q));
}

/**
 * Decide what committing `text` means.
 *
 * `visible` is what this picker may select from. `allNames` — when given —
 * is every name that exists anywhere, including rows this picker filters
 * out; a hit there but not in `visible` is what produces `blocked`.
 */
export function resolveCommit(
  text: string,
  visible: ComboOption[],
  allNames?: string[],
): ComboCommit {
  const clean = text.trim();
  if (!clean) return { kind: 'none' };

  const key = norm(clean);
  const exact = visible.find((o) => norm(o.label) === key);
  if (exact) return { kind: 'select', id: exact.id };

  if (allNames?.some((n) => norm(n) === key)) return { kind: 'blocked', name: clean };

  return { kind: 'create', name: clean };
}
