/**
 * Which game is running, and what it is allowed to do to the sprite.
 *
 * Deliberately thin. The machines and their timers live in the lazy layer, so
 * none of that weight lands on first paint; this only holds the id, the two
 * sprite overrides a game may drive, and the best-score bookkeeping.
 *
 * Scores are written the same way the mood is: silent, debounced, and merged
 * through the store rather than spread from a captured profile. The audit trail
 * is append-only and a game is not an audit event.
 */
import { useCallback, useRef, useState } from 'react';
import { useData, useStore } from '../../data/store';
import { isBetter, type GameId } from '../../lib/companionGames';
import type { MoodAction } from '../../lib/companionMood';

export interface SpriteOverride {
  /** A CSS token name driving the chest LED, or null for its own behaviour. */
  chest: string | null;
  /** Eyes held shut by a game. */
  blink: boolean;
}

export interface VikGame {
  active: GameId | null;
  override: SpriteOverride;
  scores: Record<string, number>;
  start: (id: GameId) => void;
  /** Called by a game when it ends. A null score means "nothing worth keeping". */
  finish: (id: GameId, score: number | null, won: boolean) => void;
  /** Left mid-round — he notices, and it costs you a little. */
  abandon: () => void;
  setChest: (c: string | null) => void;
  setBlink: (b: boolean) => void;
}

export function useVikGame(feel: (a: MoodAction) => void): VikGame {
  const store = useStore();
  const scores = useData((_, s) => s.me.personalization.companion?.scores ?? {});
  const [active, setActive] = useState<GameId | null>(null);
  const [override, setOverride] = useState<SpriteOverride>({ chest: null, blink: false });
  const activeRef = useRef<GameId | null>(null);
  activeRef.current = active;

  const reset = useCallback(() => {
    setActive(null);
    setOverride({ chest: null, blink: false });
  }, []);

  const start = useCallback((id: GameId) => {
    setOverride({ chest: null, blink: false });
    setActive(id);
  }, []);

  const finish = useCallback(
    (id: GameId, score: number | null, won: boolean) => {
      reset();
      feel('game-finished');
      if (won) feel('game-won');
      if (score == null) return;

      const best = store.me.personalization.companion?.scores?.[id];
      if (!isBetter(id, score, best)) return;
      store.patchPersonalization(
        {
          companion: {
            ...store.me.personalization.companion,
            scores: { ...(store.me.personalization.companion?.scores ?? {}), [id]: score },
          },
        },
        // Silent: a personal best is not an audit event, and that table can
        // never be cleaned up.
        store.asMe({ silent: true }),
      );
    },
    [feel, reset, store],
  );

  const abandon = useCallback(() => {
    if (!activeRef.current) return;
    reset();
    feel('game-abandoned');
  }, [feel, reset]);

  const setChest = useCallback((chest: string | null) => {
    setOverride((o) => (o.chest === chest ? o : { ...o, chest }));
  }, []);
  const setBlink = useCallback((blink: boolean) => {
    setOverride((o) => (o.blink === blink ? o : { ...o, blink }));
  }, []);

  return { active, override, scores, start, finish, abandon, setChest, setBlink };
}
