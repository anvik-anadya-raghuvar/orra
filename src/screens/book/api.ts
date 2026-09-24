/**
 * The public booking screen's only connection to the backend: the `book`
 * edge function, over plain fetch with the anon key.
 *
 * Not the shared Supabase client. A guest has no session, and creating the
 * client would also start auth listeners and URL-fragment detection that
 * belong to the portal, not to a stranger's booking page.
 */
import type { Slot } from '../../lib/booking';

export interface PublicPage {
  slug: string;
  title: string;
  host: string;
  timeZone: string;
  durations: number[];
  slots: Record<string, Slot[]>;
}

export interface BookedReply {
  ok: true;
  id: string | null;
  status: 'pending';
  start: string;
  end: string;
  host: string;
  timeZone: string;
}

export class BookError extends Error {
  constructor(
    public code: 'not_found' | 'slot_taken' | 'rate_limited' | 'invalid' | 'network' | 'server' | 'unconfigured',
    message: string,
  ) {
    super(message);
  }
}

function endpoint(): { url: string; key: string } {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !key) throw new BookError('unconfigured', 'Booking is not available on this copy of ORRA.');
  return { url: `${base.replace(/\/$/, '')}/functions/v1/book`, key };
}

async function call<T>(init: RequestInit & { query?: string }): Promise<T> {
  const { url, key } = endpoint();
  let res: Response;
  try {
    res = await fetch(init.query ? `${url}?${init.query}` : url, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
  } catch {
    throw new BookError('network', 'Could not reach the booking service. Check your connection and try again.');
  }
  let body: { error?: string; message?: string } & Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* fall through to the status check */
  }
  if (!res.ok) {
    const code = (['not_found', 'slot_taken', 'rate_limited', 'invalid'] as const).find((c) => c === body.error) ?? 'server';
    throw new BookError(code, body.message ?? 'Something went wrong. Please try again.');
  }
  return body as T;
}

export const fetchPage = (slug: string) =>
  call<PublicPage>({ method: 'GET', query: `slug=${encodeURIComponent(slug)}` });

export const submitBooking = (input: { slug: string; start: string; duration: number; name: string; email: string; note: string }) =>
  call<BookedReply>({ method: 'POST', body: JSON.stringify(input) });
