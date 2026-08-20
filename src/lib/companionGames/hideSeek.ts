/**
 * Hide and seek, against the actual page.
 *
 * He picks a real card — a bento tile, a board card, a panel — and peeks over
 * its top edge. Every room plays differently because every room has different
 * furniture, and it cost no new art.
 *
 * The choosing is pure and lives here; the DOM measuring lives in the hook.
 * Everything below works on plain rectangles so a test can lay out a fake page
 * and assert exactly which one he picks.
 */

export interface Box {
  /** Whatever the caller uses to find the element again. */
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** Space at the bottom he must stay clear of — the mobile tabbar. */
  bottomInset: number;
}

/** He has to fit behind it, and there has to be room to peek above it. */
export const MIN_W = 120;
export const MIN_H = 80;
/** Clear of the header, so his head is not behind a sticky bar. */
export const MIN_TOP = 72;
export const EDGE_MARGIN = 24;

/**
 * Is this box somewhere he could plausibly hide right now. Pure, so the hook
 * can pass in `insideModal` as a boolean rather than this file knowing about
 * the DOM.
 */
export function isCandidate(box: Box, view: Viewport, insideModal = false): boolean {
  if (insideModal) return false;
  if (box.width < MIN_W || box.height < MIN_H) return false;
  if (box.top < MIN_TOP) return false;
  if (box.left < EDGE_MARGIN) return false;
  if (box.left + box.width > view.width - EDGE_MARGIN) return false;
  // Fully in view, and not tucked under the tabbar.
  if (box.top + box.height > view.height - view.bottomInset) return false;
  return true;
}

/**
 * Pick one, deterministically from the seed. `exclude` is where he hid last
 * time — hiding twice in the same place is the fastest way to make a game
 * boring, so it is only reused when there is genuinely nowhere else.
 */
export function pickHideTarget(
  boxes: Box[],
  view: Viewport,
  seed: number,
  exclude?: string,
): Box | null {
  const candidates = boxes.filter((b) => isCandidate(b, view));
  if (!candidates.length) return null;
  const fresh = candidates.filter((b) => b.key !== exclude);
  const pool = fresh.length ? fresh : candidates;
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}

/**
 * Where he stands to peek over the top edge, in viewport coordinates. He is
 * clipped to his top portion by the caller — the companion layer is fixed and
 * the card is in normal flow, so he cannot actually go behind it. Clipping
 * looks identical and is always correct, where colour-matching a mask breaks
 * the moment a surface is translucent, which several of ours are.
 */
export const PEEK_VISIBLE = 0.55;

export function peekAt(box: Box, spriteW: number, spriteH: number) {
  return {
    left: Math.round(box.left + box.width / 2 - spriteW / 2),
    top: Math.round(box.top - spriteH * PEEK_VISIBLE),
  };
}

/* ── The round ────────────────────────────────────────────────────────── */

export interface HideState {
  phase: 'hiding' | 'seeking' | 'found' | 'gave-up' | 'nowhere';
  /** Which box he is behind. */
  key: string | null;
  startedAt: number;
  foundAt: number | null;
  /** How many times he has had to move because the page changed under him. */
  rehides: number;
}

export function start(key: string | null, now: number): HideState {
  return {
    phase: key ? 'hiding' : 'nowhere',
    key,
    startedAt: now,
    foundAt: null,
    rehides: 0,
  };
}

export function hidden(state: HideState): HideState {
  return state.phase === 'hiding' ? { ...state, phase: 'seeking' } : state;
}

export function found(state: HideState, now: number): HideState {
  return state.phase === 'seeking' ? { ...state, phase: 'found', foundAt: now } : state;
}

export function giveUp(state: HideState): HideState {
  return state.phase === 'found' ? state : { ...state, phase: 'gave-up' };
}

/**
 * The page moved and his hiding place is gone. He will try once more, then
 * concede — an endless re-hide against a list that keeps re-rendering is a
 * game you cannot win and cannot leave.
 */
export const MAX_REHIDES = 1;

export function rehide(state: HideState, key: string | null): HideState {
  if (state.rehides >= MAX_REHIDES || !key) return { ...state, phase: 'nowhere' };
  return { ...state, key, rehides: state.rehides + 1, phase: 'seeking' };
}

/** Seconds taken, or null if he was never found. */
export function score(state: HideState): number | null {
  if (state.phase !== 'found' || state.foundAt == null) return null;
  return Math.round((state.foundAt - state.startedAt) / 100) / 10;
}

export function verdict(state: HideState): string {
  if (state.phase === 'nowhere') return 'You win — I ran out of furniture.';
  if (state.phase === 'gave-up') return 'I was right there.';
  const s = score(state);
  if (s == null) return '…';
  if (s < 3) return `${s}s. You were watching, weren't you.`;
  if (s < 10) return `Found me in ${s}s.`;
  return `${s}s. I was getting comfortable.`;
}
