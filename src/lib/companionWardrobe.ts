/**
 * What Vik is wearing.
 *
 * Accessories hang off the sprite in slots rather than as a pile of booleans,
 * so an umbrella, a scarf and sunglasses can coexist without any of them
 * knowing about the others. One item per slot; SLOT_ORDER is also the render
 * order, interleaved with the body so a scarf sits over the torso and a hat
 * over the head.
 *
 * Everything here is reactive — it reads real weather and real task state and
 * dresses him accordingly. None of it is earned, and none of it is ever taken
 * away: an umbrella that only appears once you have poked him enough times is
 * a worse umbrella. Vanity items are what the bond unlocks later.
 */
import type { WorldSignals } from './companionWorld';

export type Slot = 'ground' | 'behind' | 'neck' | 'head' | 'face' | 'hand' | 'overhead';

export const SLOT_ORDER: Slot[] = [
  'ground',
  'behind',
  'neck',
  'head',
  'face',
  'hand',
  'overhead',
];

export type AccessoryId =
  | 'party'
  | 'graduation'
  | 'crown'
  | 'hardhat'
  | 'scarf'
  | 'sunglasses'
  | 'headphones'
  | 'umbrella'
  | 'chai'
  | 'espresso'
  // Vanity, earned through the bond. Never carries information, and never
  // outranks something that does.
  | 'bowtie'
  | 'monocle'
  | 'cape'
  | 'tophat'
  /** You are it. Not earned, not weather — a live game state. */
  | 'tagmark';

/** Which slot each item occupies. One place, so nothing can disagree. */
export const ACCESSORY_SLOT: Record<AccessoryId, Slot> = {
  party: 'head',
  graduation: 'head',
  crown: 'head',
  hardhat: 'head',
  scarf: 'neck',
  sunglasses: 'face',
  headphones: 'head',
  umbrella: 'hand',
  chai: 'hand',
  espresso: 'hand',
  bowtie: 'neck',
  monocle: 'face',
  cape: 'behind',
  tophat: 'head',
  tagmark: 'overhead',
};

/**
 * Within a slot, the higher number wins. A cleared day should out-dress a
 * study streak; a hard hat should not hide the crown you just earned.
 */
export const ACCESSORY_PRIORITY: Record<AccessoryId, number> = {
  crown: 90,
  party: 80,
  graduation: 70,
  headphones: 60,
  hardhat: 50,
  umbrella: 90,
  chai: 20,
  espresso: 20,
  scarf: 10,
  sunglasses: 10,
  // Below every reactive item that shares its slot: a scarf beats a bowtie
  // when it is actually cold, because one of them is telling you something.
  tophat: 40,
  bowtie: 5,
  monocle: 5,
  cape: 5,
  tagmark: 100,
};

export type Outfit = Partial<Record<Slot, AccessoryId>>;

/** Friday evening, local: he dresses for the weekend. */
export function isPartyTime(now: Date): boolean {
  return now.getDay() === 5 && now.getHours() >= 18;
}

/** A hot drink, chosen by the hour rather than by the country. */
function drinkFor(hour: number): AccessoryId | null {
  if (hour >= 6 && hour < 11) return 'chai';
  if (hour >= 15 && hour < 18) return 'espresso';
  return null;
}

/**
 * The outfit, resolved. Pure and deterministic: the same world always dresses
 * him the same way, and never puts two things in one slot.
 *
 * `unlocked` is whatever the bond has earned. Those are added last and always
 * lose a contested slot, so nothing you have earned can ever hide something
 * the weather or the board is trying to tell you.
 */
export function resolveOutfit(
  world: WorldSignals,
  unlocked: AccessoryId[] = [],
  /** Live game state, which is neither earned nor reactive. */
  extra: AccessoryId[] = [],
): Outfit {
  const wanted: AccessoryId[] = [];

  if (world.dayCleared) wanted.push('crown');
  if (isPartyTime(world.now)) wanted.push('party');
  if (world.studyStreak >= 3) wanted.push('graduation');
  if (world.songPlaying) wanted.push('headphones');
  if (world.stuck) wanted.push('hardhat');

  if (world.raining || world.snowing) wanted.push('umbrella');
  else {
    const drink = drinkFor(world.now.getHours());
    if (drink) wanted.push(drink);
  }

  if (world.cold) wanted.push('scarf');
  if (world.hot) wanted.push('sunglasses');

  wanted.push(...unlocked, ...extra);

  // Highest priority wins its slot; everything else is simply not worn.
  const outfit: Outfit = {};
  for (const id of wanted) {
    const slot = ACCESSORY_SLOT[id];
    const held = outfit[slot];
    if (!held || ACCESSORY_PRIORITY[id] > ACCESSORY_PRIORITY[held]) outfit[slot] = id;
  }
  return outfit;
}
