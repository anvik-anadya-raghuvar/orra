/**
 * The booking rules live beside the edge functions (supabase/functions/_shared)
 * because the Supabase CLI only bundles files under supabase/functions. The
 * app imports the very same file through here, so there is one definition.
 */
export * from '../../supabase/functions/_shared/booking.ts';
