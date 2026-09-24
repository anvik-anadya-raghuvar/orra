import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { entrance, micro } from '../../ui/motion';
import { InfoTip } from '../../ui/bits';
import BoardTab from './board';
import NextTab from './next';
import DecisionsTab from './decisions';
import QueriesTab from './queries';
import './work.css';

type Tab = 'board' | 'next' | 'decisions' | 'queries';

const TABS: { key: Tab; label: string; help: string }[] = [
  { key: 'board', label: 'To dos', help: 'Create, filter, schedule and edit the real task rows.' },
  { key: 'next', label: "What's next", help: 'Your open business work in the order the ranking would start it — by priority, by what finishing it unblocks, and by how close the due date is. Every row says why, and every task opens its synced quick editor.' },
  { key: 'decisions', label: 'Decisions', help: 'Questions that hold work up. Each one is assigned to one of you, and every task linked to it reads as blocked until it is ruled.' },
  { key: 'queries', label: 'Queries', help: 'Questions that just want an answer. They block nothing, and each one is pinged into the Us thread the moment it is asked.' },
];

export default function Work() {
  /**
   * The tab is the URL's `?tab=`, so a notice, a search result or a Home tile
   * can land on Decisions or Queries directly, and a second link while already
   * here still switches — a copy in useState would only be read on mount.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: Tab = TABS.some((item) => item.key === requested) ? (requested as Tab) : 'board';
  const setTab = (key: Tab) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', key);
        // A view asked for by a link applies to that arrival, not to every
        // later return to the board.
        next.delete('view');
        return next;
      },
      { replace: true },
    );
  /** The board reads `?view=` when it mounts; keying on it remounts the
   *  board when a link asks for a different view while Work is already open. */
  const viewParam = searchParams.get('view') ?? '';

  const [newTask, setNewTask] = useState(false);
  /** `?compose=task` — the palette's "New task". Open the composer on the
   *  board, then drop the param so closing it stays closed. */
  const compose = searchParams.get('compose');
  useEffect(() => {
    if (compose !== 'task') return;
    setNewTask(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('compose');
        next.set('tab', 'board');
        return next;
      },
      { replace: true },
    );
  }, [compose, setSearchParams]);
  const [newDecision, setNewDecision] = useState(false);
  const [newQuery, setNewQuery] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <div className="frame">
        <div className="top">
          <div className="disp feature-label">
            Work
            <InfoTip label={TABS.find((item) => item.key === tab)!.label} text={TABS.find((item) => item.key === tab)!.help} />
          </div>
          <div className="sub2" role="tablist" aria-label="Work sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                id={`wk-tab-${t.key}`}
                aria-controls="wk-panel"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {tab === 'board' && (
            <button className="btn sm solid" type="button" onClick={() => setNewTask(true)}>
              + New task
            </button>
          )}
          {tab === 'decisions' && (
            <button className="btn sm solid" type="button" onClick={() => setNewDecision(true)}>
              + New decision
            </button>
          )}
          {tab === 'queries' && (
            <button className="btn sm solid" type="button" onClick={() => setNewQuery(true)}>
              + Ask a query
            </button>
          )}
        </div>

        <div className="wrap" id="wk-panel" role="tabpanel" aria-labelledby={`wk-tab-${tab}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: entrance }}
              exit={{ opacity: 0, y: 6, transition: micro }}
            >
              {tab === 'board' && (
                <BoardTab key={viewParam} newOpen={newTask} setNewOpen={setNewTask} />
              )}
              {tab === 'next' && <NextTab />}
              {tab === 'decisions' && (
                <DecisionsTab newOpen={newDecision} setNewOpen={setNewDecision} />
              )}
              {tab === 'queries' && <QueriesTab newOpen={newQuery} setNewOpen={setNewQuery} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
