import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { planPurge, prettyKey, purgeDemo, type PurgePlan } from '../../lib/purgeDemo';

/**
 * Data — currently one job: get the worked example out of the way.
 *
 * The count is computed by matching seeded ids against what is actually in the
 * database, so it drops to zero once and stays there. If it says 0, there is
 * nothing demo left and the button has nothing to do.
 */
export default function DataTab() {
  const store = useStore();
  const ds = useData((d) => d);
  const toast = useToast();
  const [plan, setPlan] = useState<PurgePlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    let alive = true;
    planPurge(store).then((p) => alive && setPlan(p));
    return () => {
      alive = false;
    };
    // ds is the dependency that matters: recount after anything changes.
  }, [store, ds]);

  useEffect(refresh, [refresh]);

  const run = async () => {
    setBusy(true);
    try {
      const removed = await purgeDemo(store);
      toast(removed ? `Removed ${removed} demo rows` : 'Nothing left to remove');
      setConfirming(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purge failed');
    } finally {
      setBusy(false);
    }
  };

  const total = plan?.total ?? 0;

  return (
    <div>
      <div className="ad-goog">
        <div className="ad-conn-head">
          <h4>Demo content</h4>
          <span className={`pill ${total ? 'soon' : 'ok'}`}>
            {plan ? (total ? `${total} rows` : 'clean') : 'counting…'}
          </span>
        </div>
        <p>
          {total
            ? 'The worked example this portal was built against — people you have not met, mail you never received, tasks nobody opened. All of it is attributed to your two real profiles, which is why it looks like data.'
            : 'No seeded rows left. Everything here is yours.'}
        </p>
        <p className="tip" style={{ margin: '8px 0 0' }}>
          Only rows whose id came from the seed are matched. Anything you created — or Gmail
          synced — cannot be caught by this. Projects, tags, your Google connection and the audit
          trail are never touched.
        </p>
        <div className="ad-conn-acts">
          <button
            type="button"
            className="btn sm solid"
            onClick={() => setConfirming(true)}
            disabled={!total || busy}
          >
            <Trash2 size={12} strokeWidth={2} /> Remove demo content
          </button>
        </div>
      </div>

      {plan && total > 0 && (
        <motion.div className="ad-conns" {...staggerParent()}>
          {plan.hits.map((h) => (
            <motion.div key={h.key} className="ad-conn" variants={staggerItem}>
              <div className="ad-conn-head">
                <h4>{prettyKey(h.key)}</h4>
                <span className="pill q">{h.ids.length}</span>
              </div>
              <p className="mono" style={{ fontSize: 11.5 }}>
                {h.ids.slice(0, 6).join(', ')}
                {h.ids.length > 6 ? ` +${h.ids.length - 6} more` : ''}
              </p>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Remove demo content">
        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--slate)' }}>
          This deletes {total} seeded rows across {plan?.hits.length ?? 0} collections, for both
          Anadya and Raghuvar. It cannot be undone from inside the portal — the seed only reappears
          by re-running migration <span className="mono">0004</span>.
        </p>
        <p className="tip" style={{ margin: '0 0 14px' }}>
          One line goes into the audit trail recording that it happened, not {total} of them.
        </p>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn solid" onClick={run} disabled={busy}>
            {busy ? 'Removing…' : `Remove ${total} rows`}
          </button>
        </div>
      </Modal>
    </div>
  );
}
