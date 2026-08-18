import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import { planPurge, prettyKey, purgeDemo, type PurgeFailure, type PurgePlan } from '../../lib/purgeDemo';
import type { TrashItem } from '../../types';

/**
 * Data — demo cleanup, plus Trash for everything else.
 *
 * The demo count is computed by matching seeded ids against what is actually
 * in the database, so it drops to zero once and stays there. Trash is every
 * delete that has gone through the store since — the purge above included,
 * since it removes rows the same way any other delete in the app does.
 */
export default function DataTab() {
  const store = useStore();
  const ds = useData((d) => d);
  const toast = useToast();
  const [plan, setPlan] = useState<PurgePlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmForever, setConfirmForever] = useState<string | null>(null);
  /** Left over from the last attempt, so a real Postgres error is visible, not swallowed. */
  const [failures, setFailures] = useState<PurgeFailure[]>([]);

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
      const { removed, failures: failed } = await purgeDemo(store);
      setFailures(failed);
      if (failed.length) {
        toast(
          removed
            ? `Removed ${removed} rows — ${failed.length} collection${failed.length === 1 ? '' : 's'} couldn't be deleted, see below`
            : `Nothing removed — every collection failed, see below`,
        );
      } else {
        toast(removed ? `Removed ${removed} demo rows — recoverable from Trash below` : 'Nothing left to remove');
      }
      setConfirming(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purge failed');
    } finally {
      setBusy(false);
    }
  };

  const total = plan?.total ?? 0;

  const trash = [...ds.trash_items].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));

  const restore = (item: TrashItem) => {
    const ok = store.restoreFromTrash(item.id, store.asMe());
    toast(ok ? `Restored — ${item.label}` : 'Already gone');
  };

  const forever = (item: TrashItem) => {
    if (confirmForever !== item.id) {
      setConfirmForever(item.id);
      setTimeout(() => setConfirmForever((cur) => (cur === item.id ? null : cur)), 3000);
      return;
    }
    store.purgeTrashItem(item.id, store.asMe());
    setConfirmForever(null);
    toast(`Deleted for good — ${item.label}`);
  };

  const emptyAll = () => {
    const n = store.emptyTrash(store.asMe());
    toast(n ? `Trash emptied — ${n} rows gone for good` : 'Trash was already empty');
    setEmptying(false);
  };

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
        <motion.div className="ad-conns" {...staggerParent()} style={{ marginBottom: 16 }}>
          {plan.hits.map((h) => {
            const failure = failures.find((f) => f.key === h.key);
            return (
              <motion.div key={h.key} className="ad-conn" variants={staggerItem}>
                <div className="ad-conn-head">
                  <h4>{prettyKey(h.key)}</h4>
                  <span className={`pill ${failure ? 'over' : 'q'}`}>{h.ids.length}</span>
                </div>
                <p className="mono" style={{ fontSize: 11.5 }}>
                  {h.ids.slice(0, 6).join(', ')}
                  {h.ids.length > 6 ? ` +${h.ids.length - 6} more` : ''}
                </p>
                {failure && (
                  <p style={{ fontSize: 11.5, color: 'var(--rose)', margin: '6px 0 0' }}>
                    Couldn't delete — {failure.error}
                  </p>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <div className="ad-goog">
        <div className="ad-conn-head">
          <h4>Trash</h4>
          <span className={`pill ${trash.length ? 'soon' : 'ok'}`}>
            {trash.length ? `${trash.length} rows` : 'empty'}
          </span>
        </div>
        <p>
          Anything deleted anywhere in the portal — a task, a note, a person, the demo purge above
          — lands here first. Restore puts a row back exactly as it was; deleting from Trash is the
          only step in the app that cannot be undone.
        </p>
        {trash.length > 0 && (
          <div className="ad-conn-acts">
            <button type="button" className="btn sm" onClick={() => setEmptying(true)}>
              Empty trash
            </button>
          </div>
        )}
      </div>

      {trash.length > 0 && (
        <motion.div className="trash-list" {...staggerParent()}>
          {trash.map((item) => (
            <motion.div className="trash-row" key={item.id} variants={staggerItem}>
              <div className="tr-main">
                <div className="tr-label">{item.label}</div>
                <div className="tr-meta mono">
                  {prettyKey(item.collection)} · {item.deleted_by_label} · {fmtDateTime(item.deleted_at)}
                </div>
              </div>
              <div className="tr-acts">
                <button type="button" className="btn sm" onClick={() => restore(item)}>
                  <RotateCcw size={12} strokeWidth={2} /> Restore
                </button>
                <button
                  type="button"
                  className={`btn sm ${confirmForever === item.id ? 'danger' : ''}`}
                  onClick={() => forever(item)}
                >
                  <X size={12} strokeWidth={2} /> {confirmForever === item.id ? 'Confirm?' : 'Delete forever'}
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Remove demo content">
        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--slate)' }}>
          This deletes {total} seeded rows across {plan?.hits.length ?? 0} collections, for both
          Anadya and Raghuvar. Every row lands in Trash below first, so this is recoverable — until
          Trash is emptied.
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

      <Modal open={emptying} onClose={() => setEmptying(false)} title="Empty trash">
        <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--slate)' }}>
          Permanently deletes all {trash.length} rows currently in Trash. This is the one action in
          the whole portal that cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setEmptying(false)}>
            Cancel
          </button>
          <button className="btn solid danger" onClick={emptyAll}>
            Empty trash for good
          </button>
        </div>
      </Modal>
    </div>
  );
}
