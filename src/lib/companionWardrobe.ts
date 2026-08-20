/**
 * What Vik is wearing.
 *
 * Accessories hang off the sprite in slots rather than as a pile of booleans,
 * so an umbrella, a scarf and sunglasses can coexist without any of them
 * knowing about the others. One item per slot; SLOT_ORDER is also the render
 * order, interleaved with the body so a scarf sits over the torso and a hat
 * under nothing.
 *
 * Only the Friday hat exists so far — the mechanism arrives before the
 * wardrobe does, because it is the mechanism that the rest of it needs.
 */

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

export type AccessoryId = 'party';

export type Outfit = Partial<Record<Slot, AccessoryId>>;

/** Everything outside Vik that the wardrobe reads. Widens as the wardrobe does. */
export interface WardrobeWorld {
  /** The reader's own wall clock. */
  now: Date;
}

/** Friday evening, local: he dresses for the weekend. */
export function isPartyTime(now: Date): boolean {
  return now.getDay() === 5 && now.getHours() >= 18;
}

/**
 * The outfit, resolved. Pure and deterministic: the same world always dresses
 * him the same way, and never puts two things in one slot.
 */
export function resolveOutfit(world: WardrobeWorld): Outfit {
  const outfit: Outfit = {};
  if (isPartyTime(world.now)) outfit.head = 'party';
  return outfit;
}
