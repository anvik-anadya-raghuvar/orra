/**
 * One-off things Vik says that did not come from the announcement engine —
 * a poke reaction, a celebration, an "ow". They live for a fixed beat and
 * expire on their own; nothing queues, the newest simply wins.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const QUIP_MS = 2_600;

export function useVikVoice() {
  const [quip, setQuip] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const say = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setQuip(text);
    timerRef.current = window.setTimeout(() => setQuip(null), QUIP_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { quip, say };
}
