import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One Supabase client for the whole app.
 *
 * Creating a second client with the same storage key makes the two fight over
 * the session — and the password-recovery link only ever lands in one of them,
 * so a second client silently breaks the reset flow. Everything goes through
 * this.
 */
let client: SupabaseClient | null = null;

export const supabaseConfigured = () =>
  Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export async function getSupabase(): Promise<SupabaseClient> {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The recovery link arrives as a URL fragment; let the client consume it.
        detectSessionInUrl: true,
      },
    },
  );
  return client;
}

/** True when the current URL is a Supabase password-recovery landing. */
export function isRecoveryUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  return (
    hash.includes('type=recovery') ||
    search.includes('type=recovery') ||
    hash.includes('error_code=otp_expired') ||
    search.includes('code=') // PKCE recovery exchange
  );
}
