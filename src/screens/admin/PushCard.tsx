/**
 * Turning on notifications for this device.
 *
 * Per device rather than per person, because that is what a push subscription
 * actually is: one browser on one machine. Your phone, tablet and laptop each
 * opt in separately, and the list below shows every device either of you has
 * connected — so "why didn't my phone buzz" is answerable by looking.
 */
import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { fmtDateTime } from '../../lib/dates';
import {
  currentSubscription,
  disablePush,
  enablePush,
  isInstalled,
  pushSupport,
  sendPush,
  type PushSupport,
} from '../../lib/push';

const EXPLAIN: Record<PushSupport, string> = {
  ready: 'Get a notification when a message arrives or something is due — even with the portal closed.',
  unsupported: 'This browser cannot receive push notifications.',
  'needs-install': 'On iPhone and iPad this works only once ORRA is added to the home screen — Safari does not allow notifications to an ordinary tab. Add it, open it from the icon, then come back here.',
  'not-configured': 'Push is not configured on this deployment yet: it needs a VAPID key pair set on Vercel and Supabase.',
  blocked: 'Notifications are blocked for this site in your browser settings. Allow them there, then reload this page.',
};

export default function PushCard() {
  const store = useStore();
  const toast = useToast();
  const devices = useData((ds) => ds.push_subscriptions ?? []);
  const [support, setSupport] = useState<PushSupport>('unsupported');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setSupport(pushSupport());
    setOn(Boolean(await currentSubscription()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    try {
      const result = on ? await disablePush() : await enablePush(store.meId);
      toast(result.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const mine = devices.filter((device) => device.user_id === store.meId);
  const theirs = devices.filter((device) => device.user_id !== store.meId);

  return (
    <div className="ad-goog">
      <div className="ad-conn-head">
        <h4>Notifications on this device</h4>
        <span className={`pill ${on ? 'ok' : support === 'ready' ? 'soon' : 'q'}`}>
          {on ? 'on' : support === 'ready' ? 'off' : support.replace('-', ' ')}
        </span>
      </div>
      <p>{EXPLAIN[support]}</p>

      <div className="ad-conn-acts">
        <button
          type="button"
          className={`btn sm ${on ? '' : 'solid'}`}
          disabled={busy || (support !== 'ready' && !on)}
          onClick={() => void toggle()}
        >
          {busy ? <Loader2 size={12} strokeWidth={2} /> : <BellRing size={12} strokeWidth={2} />}{' '}
          {busy ? 'Working…' : on ? 'Turn off here' : 'Notify me on this device'}
        </button>
        {on && (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => {
              void sendPush(store.meId, {
                title: 'ORRA',
                body: 'This is a test — notifications are working.',
                url: '/',
                tag: 'orra-test',
                kind: 'test',
              });
              toast('Test sent — it should arrive in a moment.');
            }}
          >
            Send me a test
          </button>
        )}
      </div>

      {!isInstalled() && support === 'ready' && (
        <p className="tip">
          Tip: install ORRA to your home screen as well — notifications are more reliable from the
          installed app, and on iPhone they only work that way.
        </p>
      )}

      {(mine.length > 0 || theirs.length > 0) && (
        <div className="ad-google-accounts">
          {[...mine, ...theirs].map((device) => (
            <div className="ad-google-account" key={device.id}>
              <div className="ad-google-account-copy">
                <strong>
                  {device.label}
                  {device.user_id !== store.meId ? ` · ${store.other.name}` : ''}
                </strong>
                <span>
                  {device.expired_at
                    ? 'no longer reachable — turn it on again on that device'
                    : device.last_used_at
                      ? `last notified ${fmtDateTime(device.last_used_at)}`
                      : 'connected, not yet used'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
