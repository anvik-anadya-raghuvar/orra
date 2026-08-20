/**
 * Vik during your own focus block.
 *
 * He is unmounted from the normal companion layer while your block runs, and
 * that stays true: the block overlay is a full-screen blur at z-100 and putting
 * a draggable, pokeable toy on top of it would breach the one rule the whole
 * companion is built around. So this is a second, deliberately crippled Vik,
 * rendered inside the overlay's own DOM.
 *
 * No pointer events, no bubble, no drag, no poke, no games, and he earns
 * nothing. He marches, and he gets more tired as the minutes go by. That is the
 * entire feature.
 */
import { motion } from 'framer-motion';
import { useAnimateIn } from '../motion';
import RobotSprite from './RobotSprite';
import type { VikPose } from '../../lib/companionPose';
import './companionBlock.css';

/** How he holds up over a long block. Minutes elapsed, in order. */
const STAGES: { after: number; pose: VikPose; step: number }[] = [
  { after: 0, pose: { expression: 'neutral', body: 'stand' }, step: 0.5 },
  { after: 12, pose: { expression: 'soft', body: 'stand' }, step: 0.75 },
  { after: 30, pose: { expression: 'weary', body: 'stand' }, step: 1.1 },
  { after: 50, pose: { expression: 'yawn', body: 'stand' }, step: 1.6 },
];

export function stageFor(minutes: number) {
  let stage = STAGES[0];
  for (const s of STAGES) if (minutes >= s.after) stage = s;
  return stage;
}

export default function BlockCompanion({ minutes }: { minutes: number }) {
  const animate = useAnimateIn();
  const stage = stageFor(minutes);

  return (
    <div className="vik-block" aria-hidden>
      <motion.div
        className="vik-block-figure"
        // Marching in place, slower as he tires. Under reduced motion he simply
        // stands there looking however tired he has got to.
        animate={animate ? { y: [0, -3, 0] } : undefined}
        transition={{ duration: stage.step, repeat: Infinity, ease: 'easeInOut' }}
      >
        <RobotSprite pose={stage.pose} animate={animate} size={34} />
      </motion.div>
    </div>
  );
}
