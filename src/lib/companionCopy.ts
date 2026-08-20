/**
 * Everything the companion robot says.
 *
 * A hand-curated bank, same doctrine as quotes.ts: deliberately not an API and
 * deliberately not an LLM. The robot's charm is that its lines were written by
 * the people it talks to — appending to a bank here is the whole maintenance
 * story, and the rotation widens by itself.
 *
 * Variants are picked by a date hash so the same day shows the same line
 * across reloads — a greeting that changes every render reads as random noise,
 * one that changes daily reads as a personality.
 */

export type RobotMood =
  | 'idle'
  | 'happy'
  | 'wave'
  | 'excited'
  | 'sleepy'
  | 'point'
  | 'giggle'
  | 'dizzy'
  | 'grumpy';

export interface GreetingCtx {
  name: string;
  otherName: string;
  /** The other person's wall clock right now, HH:MM. */
  otherClock: string;
  otherCity: string;
}

export const GREETINGS: Record<'morning' | 'afternoon' | 'evening', ((c: GreetingCtx) => string)[]> =
  {
    morning: [
      (c) => `Buongiorno, ${c.name} ☀️ Fresh day — pick a capacity and I'll keep out of the way.`,
      (c) => `Morning, ${c.name}! It's already ${c.otherClock} for ${c.otherName} over in ${c.otherCity}.`,
      (c) => `Up and at it, ${c.name}? I dusted the corner while you were gone.`,
      (c) => `Good morning ${c.name} — coffee first, board second. I don't make the rules.`,
    ],
    afternoon: [
      (c) => `Afternoon, ${c.name}. Water, posture, one deep thing — in that order.`,
      (c) => `Hi ${c.name} — halfway through. ${c.otherName}'s clock says ${c.otherClock} in ${c.otherCity}.`,
      (c) => `Still here, ${c.name}. Still rooting for you. Quietly. From the corner.`,
    ],
    evening: [
      (c) => `Evening, ${c.name}. Anything worth closing before the day closes?`,
      (c) => `Ciao ${c.name} — the day's winding down. One small win left in it?`,
      (c) => `Evening! Future-you loves a shutdown ritual. Just passing that along.`,
    ],
  };

/** "The other one just appeared" — Phase 2 wires these to presence joins. */
export const JOIN_LINES: ((otherName: string) => string)[] = [
  (n) => `${n} just came online 👋`,
  (n) => `Heads up — ${n} is around now.`,
  (n) => `${n} logged in. The band's back together.`,
];

export interface CompanionTip {
  key: string;
  text: string;
  /** Show only on matching routes. Absent = anywhere. */
  route?: (pathname: string) => boolean;
  action?: { label: string; to: string };
  mood?: RobotMood;
}

const onHome = (r: string) => r === '/';
const onWork = (r: string) => r.startsWith('/work') || r.startsWith('/task');

/** Route-aware usage tips. Order is irrelevant — rotation is least-recently-shown. */
export const TIPS: CompanionTip[] = [
  {
    key: 'home-drag',
    text: 'You can drag Home tiles around and resize them. Your arrangement sticks — theirs is untouched.',
    route: onHome,
  },
  {
    key: 'home-customise',
    text: "Customise on Home hides tiles you don't use. It re-flows the grid, never leaves a hole.",
    route: onHome,
  },
  {
    key: 'tile-peek',
    text: 'Tap a tile to peek at its full page in a pop-up — no need to leave Home.',
    route: onHome,
  },
  {
    key: 'capacity-plan',
    text: '“Make this my day” turns the ranked plan into today\'s intentions in one tap.',
    route: onHome,
  },
  {
    key: 'founder-block',
    text: 'A Founder block is a 50-minute clock over startup work only. Everything else waits its turn.',
    action: { label: 'Work board', to: '/work' },
  },
  {
    key: 'reflow-preview',
    text: 'When a date slips, you get a reflow preview first. Nothing ever moves silently.',
    route: onWork,
  },
  {
    key: 'tags-freeform',
    text: 'Tags are whatever you type. Invent your own vocabulary — there is no fixed list.',
    route: onWork,
  },
  {
    key: 'task-types',
    text: "A task's type changes what its page shows — a bug page and a study page are different rooms.",
    route: onWork,
  },
  {
    key: 'dictation',
    text: 'The mic dictates into any field. Talk, and the words land where the cursor is.',
  },
  {
    key: 'inbox-handoff',
    text: 'Tasks assigned to you arrive in an inbox strip — accept or push back, nothing sneaks mid-column.',
    route: onWork,
  },
  {
    key: 'quote-shared',
    text: 'The quote tile shows the same quote to both of you each day. Free conversation starter.',
    route: onHome,
  },
  {
    key: 'song-us',
    text: 'Send a song from the Moments tile — it lands in Us with a play button.',
    action: { label: 'Open Us', to: '/us' },
  },
  {
    key: 'snooze-me',
    text: "If I get chatty, tap the zZ on my bubble and I'll nap for four hours. No hard feelings.",
    mood: 'sleepy',
  },
  {
    key: 'drag-me',
    text: "You can pick me up and drop me anywhere, by the way. I don't mind. Much.",
    mood: 'giggle',
  },
  {
    key: 'theme-chip',
    text: 'The chip in the header flips light and dark. Deep Field is the good one — just saying.',
  },
];

/** Deterministic index for a variant list — same day, same line. */
export function hashPick(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return length > 0 ? hash % length : 0;
}

/** 'Asia/Kolkata' → 'Kolkata'. Good enough for the two cities that matter. */
export function cityOf(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}
