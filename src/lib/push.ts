/**
 * Turning on push, per device.
 *
 * The bell only exists while a portal tab is open, and the browser
 * notification it fires is suppressed whenever that tab is in front — so the
 * one case that actually matters, the app closed and the phone in a pocket,
 * reached nobody. This is the piece that fixes it.
 *
 * Per device, not per person, deliberately: a subscription addresses one
 * browser on one machine. Your phone, your tablet and your laptop each opt in
 * separately, and turning it off on the laptop should not silence the phone.
 *
 * On iOS this only works once the app has been added to the home screen —
 * Safari refuses push to a plain tab. `pushSupport()` reports that case
 * distinctly so the settings row can say so rather than looking broken.
 */
import { getSupabase, supabaseConfigured } from './supabaseClient';

/** Public by design — it is handed to the push service to identify the sender.
 *  The matching private key lives only in Supabase's secrets. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushSupport =
  | 'ready'
  | 'unsupported'
  | 'needs-install'
  | 'not-configured'
  | 'blocked';

/** Is the app running as an installed app rather than a browser tab? */
export function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS reports it here rather than through display-mode.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // Safari on iOS only exposes PushManager to an installed app, so this is
    // the shape "you must add it to your home screen first" arrives in.
    return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (!VAPID_PUBLIC_KEY || !supabaseConfigured()) return 'not-configured';
  return 'ready';
}

/** The push API wants the key as raw bytes, not the base64url it travels as.
 *  Typed against a plain ArrayBuffer because applicationServerKey rejects the
 *  SharedArrayBuffer-backed view TypeScript otherwise infers. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Base64url for the two keys the server needs to seal a payload. */
function keyToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A name a person can tell apart from their other two devices. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'browser';
  return `${platform} · ${browser}${isInstalled() ? ' (installed)' : ''}`;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
}

/** Is this device already subscribed? */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Ask permission, subscribe this device, and save the addressing information.
 *
 * Returns a sentence to show the user rather than throwing: every failure
 * here is something they need told, not something the app should crash on.
 */
export async function enablePush(userId: string): Promise<{ ok: boolean; message: string }> {
  const support = pushSupport();
  if (support === 'needs-install') {
    return { ok: false, message: 'On iPhone and iPad, add ORRA to your home screen first — Safari only allows notifications to an installed app.' };
  }
  if (support === 'unsupported') return { ok: false, message: 'This browser cannot receive push notifications.' };
  if (support === 'not-configured') return { ok: false, message: 'Push is not configured on this deployment yet.' };
  if (support === 'blocked') {
    return { ok: false, message: 'Notifications are blocked for this site in your browser settings — allow them there, then try again.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, message: 'Notifications were not allowed.' };

  const reg = await registration();
  if (!reg) return { ok: false, message: 'The background worker is not running yet — reload and try again.' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      // Non-optional in every current browser: a push that shows nothing is
      // not allowed, which suits us — every push here has something to say.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    });
  }

  const sb = await getSupabase();
  const { error } = await sb.from('push_subscriptions').upsert(
    {
      id: `push-${await fingerprint(sub.endpoint)}`,
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: keyToBase64(sub.getKey('p256dh')),
      auth: keyToBase64(sub.getKey('auth')),
      label: deviceLabel(),
      expired_at: null,
    },
    { onConflict: 'endpoint' },
  );
  if (error) return { ok: false, message: `Could not save this device — ${error.message}` };
  return { ok: true, message: `${deviceLabel()} will now be notified.` };
}

/** Stop this device receiving push, and forget its addressing information. */
export async function disablePush(): Promise<{ ok: boolean; message: string }> {
  const sub = await currentSubscription();
  if (!sub) return { ok: true, message: 'This device was not receiving notifications.' };
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  if (supabaseConfigured()) {
    const sb = await getSupabase();
    await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
  return { ok: true, message: 'This device will no longer be notified.' };
}

/**
 * Send a push to a person, through the edge function that holds the private
 * key. Best effort by design: a message must still send when push does not.
 */
export async function sendPush(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string; kind?: string },
): Promise<void> {
  if (!supabaseConfigured()) return;
  try {
    const sb = await getSupabase();
    await sb.functions.invoke('push', { body: { user_id: userId, ...payload } });
  } catch {
    /* the thing that prompted the push has already happened; do not undo it */
  }
}

/** A short, stable id per endpoint so re-subscribing updates one row. */
async function fingerprint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
