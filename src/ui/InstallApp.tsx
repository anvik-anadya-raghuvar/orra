import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from './bits';
import { installCase, onInstallChange, promptInstall, type InstallCase } from '../lib/install';

/**
 * "Install ORRA" — shown until ORRA is running from the home screen.
 *
 * Where the browser offers a real install prompt (Android Chrome, Edge,
 * Samsung Internet, desktop Chrome) this is one tap. Everywhere else it opens
 * the exact steps for the browser you are in, including the case that caught
 * us out: a link opened inside WhatsApp or Gmail, which cannot install at all.
 */
export function InstallApp({ variant = 'chip' }: { variant?: 'chip' | 'block' }) {
  const [kind, setKind] = useState<InstallCase>(() => installCase());
  const [open, setOpen] = useState(false);

  useEffect(() => onInstallChange(() => setKind(installCase())), []);

  if (kind === 'installed') return null;

  const onClick = async () => {
    if (kind === 'prompt') {
      await promptInstall();
      setKind(installCase());
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={variant === 'chip' ? 'chip' : 'btn solid'}
        onClick={() => void onClick()}
        aria-label="Install ORRA"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44 }}
      >
        <Download size={15} strokeWidth={2} aria-hidden />{' '}
        <span className={variant === 'chip' ? 'bar-label' : undefined}>Install ORRA</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Put ORRA on your home screen">
        <InstallSteps kind={kind} />
        <button type="button" className="btn solid" style={{ marginTop: 14, minHeight: 44 }} onClick={() => setOpen(false)}>
          Done
        </button>
      </Modal>
    </>
  );
}

const url = typeof window !== 'undefined' ? window.location.origin : 'https://teamorra.vercel.app';

function InstallSteps({ kind }: { kind: InstallCase }) {
  const list = (steps: React.ReactNode[]) => (
    <ol style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 8, lineHeight: 1.45 }}>
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
  switch (kind) {
    case 'in-app':
      return (
        <>
          <p className="tip" style={{ margin: 0 }}>
            You opened ORRA inside another app (WhatsApp, Gmail, Instagram…). Those can't install apps.
          </p>
          {list([
            <>Tap the <b>⋮</b> or <b>•••</b> menu at the top of this screen.</>,
            <>Choose <b>Open in Chrome</b> (Android) or <b>Open in Safari</b> (iPhone). Or type <b>{url}</b> there yourself.</>,
            <>Tap <b>Install ORRA</b> again from there.</>,
          ])}
        </>
      );
    case 'ios-safari':
    case 'ios-other':
      return (
        <>
          {list([
            <>Tap the <b>Share</b> button (the square with an arrow){kind === 'ios-safari' ? ' at the bottom of Safari' : ' in the address bar'}.</>,
            <>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</>,
            <>Open ORRA from the new icon on your home screen, not from the browser. Alerts only work from there.</>,
          ])}
          {kind === 'ios-other' && (
            <p className="tip" style={{ marginTop: 10 }}>
              No "Add to Home Screen"? Your iPhone needs iOS 16.4 or later for other browsers. Open {url} in Safari instead.
            </p>
          )}
        </>
      );
    case 'android-manual':
      return list([
        <>Open this page in <b>Chrome</b> (or Samsung Internet).</>,
        <>Tap the <b>⋮</b> menu at the top right.</>,
        <>Tap <b>Install app</b> (or <b>Add to Home screen</b>, then <b>Install</b>).</>,
        <>Open ORRA from the new icon.</>,
      ]);
    case 'desktop-manual':
      return list([
        <>In Chrome or Edge, click the <b>install icon</b> at the right end of the address bar, or open the menu and choose <b>Install ORRA</b>.</>,
        <>ORRA opens in its own window and gets alerts like any app.</>,
      ]);
    default:
      return null;
  }
}
