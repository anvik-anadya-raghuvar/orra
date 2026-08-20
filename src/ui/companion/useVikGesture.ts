/**
 * The one-shot gesture slot. Exactly one gesture runs at a time — a new one
 * replaces whatever was playing rather than queueing behind it, because a
 * stretch that starts four seconds after you asked for it reads as a glitch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GESTURE_MS, type Gesture } from '../../lib/companionPose';

export function useVikGesture() {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const timerRef = useRef<number | null>(null);

  const doGesture = useCallback((g: Gesture, ms = GESTURE_MS[g]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setGesture(g);
    timerRef.current = window.setTimeout(() => setGesture(null), ms);
  }, []);

  const clearGesture = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setGesture(null);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { gesture, doGesture, clearGesture };
}
