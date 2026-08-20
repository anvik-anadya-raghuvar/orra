/**
 * The wardrobe, drawn.
 *
 * Each accessory is a small group of paths in the sprite's 64x74 viewBox,
 * positioned for the resting pose. Colour comes from CSS custom properties in
 * companion.css, same as the body, so both themes work with no per-theme code
 * here.
 *
 * Lazy-loaded: none of this is needed on first paint, and most days he wears
 * one or two items out of ten.
 */
import type { AccessoryId } from '../../lib/companionWardrobe';

/** Head: worn between the head rect and the face plate. */
function Party() {
  return (
    <g className="vik-hat">
      <polygon points="37,10.5 46,9 43.5,1.5" />
      <circle cx="43.5" cy="1.5" r="1.7" />
    </g>
  );
}

function Graduation() {
  return (
    <g className="vik-hat vik-mortar">
      <polygon points="32,2.5 48,7.5 32,12.5 16,7.5" />
      <path className="vik-tassel" d="M45,9 L45,14" />
      <circle cx="45" cy="14.6" r="1.5" />
    </g>
  );
}

function Crown() {
  return (
    <g className="vik-hat vik-crown">
      <polygon points="21,8.5 21,1.5 26,5.5 32,0.5 38,5.5 43,1.5 43,8.5" />
      <circle cx="32" cy="4.2" r="1.2" />
    </g>
  );
}

function HardHat() {
  return (
    <g className="vik-hat vik-hardhat">
      <path d="M16,9.5 a16,12 0 0,1 32,0 Z" />
      <rect x="14" y="9" width="36" height="2.6" rx="1.3" />
      <path className="vik-hardhat-rib" d="M32,0.5 L32,9" />
    </g>
  );
}

function Headphones() {
  return (
    <g className="vik-cans">
      <path d="M15,21 a17,17 0 0,1 34,0" />
      <rect x="11.5" y="18.5" width="6" height="10" rx="3" />
      <rect x="46.5" y="18.5" width="6" height="10" rx="3" />
    </g>
  );
}

/** Face: worn over the eyes, under nothing. */
function Sunglasses() {
  return (
    <g className="vik-shades">
      <rect x="20.5" y="16" width="10" height="7.5" rx="2.6" />
      <rect x="33.5" y="16" width="10" height="7.5" rx="2.6" />
      <path className="vik-shades-bridge" d="M30.5,19 L33.5,19" />
    </g>
  );
}

/** Neck: worn over the torso, below the head. */
function Scarf() {
  return (
    <g className="vik-scarf">
      <rect x="17.5" y="34" width="29" height="5.2" rx="2.6" />
      <path d="M40,38.5 q3.5,5 1.5,10 l-4.5,-1 q1.5,-4.5 -0.5,-8.5 Z" />
    </g>
  );
}

/**
 * Hand: stood beside him rather than gripped, because a canopy that tracked a
 * rotating arm would be unreadable at 58px and wrong at every other angle.
 * Everything sits right of x=52, clear of the head and the right arm.
 */
function Umbrella() {
  return (
    <g className="vik-brolly">
      <path className="vik-brolly-canopy" d="M44,12 a9,7 0 0,1 18,0 Z" />
      <path className="vik-brolly-stick" d="M53,12 L53,50 q0,3 -3,3" />
    </g>
  );
}

function Cup({ className }: { className: string }) {
  return (
    <g className={`vik-cup ${className}`}>
      <path d="M45.5,45 h8 v5.5 a4,4 0 0,1 -8,0 Z" />
      <path className="vik-cup-handle" d="M53.5,46.5 a2.4,2.4 0 0,1 0,4" />
      <path className="vik-steam" d="M48,43.5 q1.2,-1.6 0,-3.2" />
      <path className="vik-steam" d="M51,43.5 q1.2,-1.6 0,-3.2" />
    </g>
  );
}

const ART: Record<AccessoryId, () => JSX.Element> = {
  party: Party,
  graduation: Graduation,
  crown: Crown,
  hardhat: HardHat,
  headphones: Headphones,
  sunglasses: Sunglasses,
  scarf: Scarf,
  umbrella: Umbrella,
  chai: () => <Cup className="chai" />,
  espresso: () => <Cup className="espresso" />,
};

export default function Accessory({ id }: { id: AccessoryId }) {
  const Art = ART[id];
  return Art ? <Art /> : null;
}
