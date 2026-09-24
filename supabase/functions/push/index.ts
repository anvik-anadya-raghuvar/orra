/**
 * Send a Web Push to one person's devices.
 *
 * This is the only piece of the portal that runs on a server, and it exists
 * for one reason: the VAPID private key that authorises a push must never be
 * in the browser bundle. Everything else about push happens client-side.
 *
 * Delivery itself is done by the browser vendors' own push services (FCM for
 * Chrome, Mozilla's for Firefox, Apple's for Safari). There is no third-party
 * notification service here and nothing to pay for — which is the whole
 * reason this approach was chosen over OneSignal or Firebase Cloud Messaging
 * with an SDK.
 *
 * Deploy:  npx supabase functions deploy push --no-verify-jwt
 * Secrets: npx supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:you@example.com
 *          npx supabase secrets set ORRA_INTERNAL_SECRET=...   (same value as Vault's orra_internal_secret)
 *
 * Who may call it (checked here, not by the gateway — `--no-verify-jwt`
 * because the gateway's legacy check rejects the project's newer keys):
 *   · a signed-in member: a user JWT whose email is on the allowlist, or
 *   · the database / another function: header `x-orra-internal` equal to
 *     ORRA_INTERNAL_SECRET (pg_cron reminders and digest, the booking page).
 * Before 2026-09-24 anyone holding the public anon key could push any text
 * to either of your phones.
 */
// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-orra-internal',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:anvik.anadya@gmail.com';
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ error: 'VAPID keys are not set on this project' }, 500);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const userId: string | undefined = payload.user_id;
  const title = String(payload.title ?? 'ORRA').slice(0, 200);
  const body = String(payload.body ?? '').slice(0, 500);
  const url = String(payload.url ?? '/').slice(0, 300);
  const tag = String(payload.tag ?? 'orra').slice(0, 60);
  const kind = String(payload.kind ?? 'message').slice(0, 40);
  if (!userId) return json({ error: 'user_id is required' }, 400);

  // The service role is used here and only here: this function has to read
  // another person's subscription rows to notify them, which is exactly what
  // RLS is meant to prevent from a browser. It never leaves this file, and
  // the function is the only thing holding it.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── caller check ─────────────────────────────────────────────────────
  const internal = Deno.env.get('ORRA_INTERNAL_SECRET');
  const presented = req.headers.get('x-orra-internal');
  let allowed = Boolean(internal && presented && timingSafeEqual(internal, presented));
  if (!allowed) {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (token) {
      const { data: who } = await supabase.auth.getUser(token);
      const email = who?.user?.email?.toLowerCase();
      if (email) {
        const { data: member } = await supabase
          .from('allowlist')
          .select('email')
          .eq('email', email)
          .maybeSingle();
        allowed = Boolean(member);
      }
    }
  }
  if (!allowed) return json({ error: 'not allowed' }, 401);

  // Only ever notify one of the members.
  const { data: target } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (!target) return json({ error: 'unknown user' }, 404);

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
    .is('expired_at', null);

  if (error) return json({ error: error.message }, 500);

  const log = async (outcome: string, detail?: string) => {
    await supabase.from('push_log').insert({
      id: `plog-${crypto.randomUUID().slice(0, 12)}`,
      user_id: userId,
      kind,
      title,
      body,
      outcome,
      detail: detail?.slice(0, 500) ?? null,
    });
  };

  if (!subs?.length) {
    await log('no_devices');
    return json({ sent: 0, reason: 'no devices subscribed' });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const message = JSON.stringify({ title, body, url, tag });

  let sent = 0;
  const failures: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
        );
        sent += 1;
        await supabase
          .from('push_subscriptions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', sub.id);
      } catch (err: any) {
        const status = err?.statusCode;
        // 404/410 mean the browser threw this subscription away — the device
        // was reset, or notifications were turned off there. Mark it rather
        // than retrying it forever, and keep the row so the person can still
        // see the device was once connected.
        if (status === 404 || status === 410) {
          await supabase
            .from('push_subscriptions')
            .update({ expired_at: new Date().toISOString() })
            .eq('id', sub.id);
          failures.push(`${sub.id}: gone`);
        } else {
          failures.push(`${sub.id}: ${status ?? ''} ${err?.message ?? 'failed'}`.trim());
        }
      }
    }),
  );

  await log(sent > 0 ? 'sent' : 'failed', failures.join('; ') || undefined);
  return json({ sent, failed: failures.length, failures });
});

/** Constant-time string compare, so the secret cannot be guessed by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}
