/**
 * A one-shot handoff between rooms.
 *
 * The palette can send you to a wiki page or a scribble, but the Knowledge
 * room keeps its tab in local state with no deep link — there is no URL that
 * means "the Wiki tab, on this page". Rather than rebuild every room's tab
 * state as routing to ship a search box, the palette leaves a note here and
 * the destination reads it once on arrival.
 *
 * sessionStorage rather than a module variable so it survives the navigation
 * even if the destination route is lazily loaded and mounts a tick later.
 */
const KEY = 'anvik:jump';

export interface Jump {
  /** Which tab the Notebook should open on. Keys match the room's own. */
  knowledgeTab?: 'notes' | 'wiki' | 'mail' | 'docs';
  /** A wiki page to select once that tab is open. */
  pageId?: string;
  /** Text to prefill the destination's own search box with. */
  query?: string;
}

export function setJump(jump: Jump): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(jump));
  } catch {
    /* a jump is a convenience; a full quota must not break navigation */
  }
}

/** Read and consume. Returns null when there is nothing waiting, so a normal
 *  visit to a room is never redirected by a stale note. */
export function takeJump(): Jump | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as Jump;
  } catch {
    return null;
  }
}
