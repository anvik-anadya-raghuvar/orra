/**
 * Getting ORRA onto a phone's home screen.
 *
 * It is a web app, so there is no store download — the browser installs it.
 * Every browser hides that differently (Chrome's ⋮ menu, Safari's Share
 * sheet), and the in-app browsers WhatsApp, Gmail, Instagram and friends open
 * links in cannot install anything at all. "Unable to download the app" was
 * all three. This works out which case you are in so the button can either
 * install in one tap or say exactly what to do.
 */

/** Chrome/Edge/Samsung Internet's deferred install prompt. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/**
 * Must run at startup: the browser fires `beforeinstallprompt` once, early,
 * and a listener added later by a lazily rendered button would miss it.
 */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep it for our own button instead of the mini-bar
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type InstallCase =
  | 'installed' //      already running from the home screen
  | 'prompt' //         one-tap install available (Android Chrome, Edge, desktop Chrome)
  | 'ios-safari' //     Share → Add to Home Screen
  | 'ios-other' //      Chrome/Firefox on iPhone: Share → Add to Home Screen too (iOS 16.4+)
  | 'in-app' //         WhatsApp / Gmail / Instagram webview: cannot install, open in a browser
  | 'android-manual' // Android browser without the prompt yet: ⋮ menu → Install app
  | 'desktop-manual'; // desktop browser without the prompt

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** Pure, so it can be tested against real user-agent strings. */
export function classifyInstall(ua: string, opts: { standalone: boolean; hasPrompt: boolean; touchMac: boolean }): InstallCase {
  if (opts.standalone) return 'installed';
  const ios = /iPad|iPhone|iPod/.test(ua) || opts.touchMac;
  // Webviews: Facebook/Instagram/Line/LinkedIn/Snapchat/Gmail/Google app on
  // iOS, and Android's "; wv)" marker, which WhatsApp and Gmail both carry.
  const inApp =
    /FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|GSA\/|GmailWebview|WhatsApp/i.test(ua) || /; wv\)/.test(ua);
  if (inApp) return 'in-app';
  if (opts.hasPrompt) return 'prompt';
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return 'android-manual';
  return 'desktop-manual';
}

export function installCase(): InstallCase {
  return classifyInstall(navigator.userAgent, {
    standalone: isStandalone(),
    hasPrompt: deferred !== null,
    touchMac: navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1,
  });
}

/** Show the browser's own install dialog. True when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null; // a prompt can be used once
  await event.prompt();
  const { outcome } = await event.userChoice;
  emit();
  return outcome === 'accepted';
}
