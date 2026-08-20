/**
 * Resolve a stored photo to something an `<img>` can load.
 *
 * `attachment_url` is either a storage path (production, private bucket) or a
 * data URL (mock mode) — `momentSrc` handles both, but it is async and the
 * signed URL expires, so every place that renders a sent photo needs the same
 * three-state effect. It was written three times over; this is the one copy.
 *
 * `undefined` means still resolving, `null` means there is nothing to show.
 */
import { useEffect, useState } from 'react';
import { momentSrc } from './moments';

export function useMomentSrc(attachment: string | null | undefined): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!attachment) {
      setSrc(null);
      return;
    }
    setSrc(undefined);
    momentSrc(attachment).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [attachment]);
  return src;
}
