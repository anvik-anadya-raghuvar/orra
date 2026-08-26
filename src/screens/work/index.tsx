import { useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { entrance, micro } from '../../ui/motion';
import { InfoTip } from '../../ui/bits';
import BoardTab from './board';
import GoalsTab from './goals';
import DecisionsTab from './decisions';
import QueriesTab from './queries';
import './work.css';

type Tab = 'board' | 'goals' | 'decisions' | 'queries';

const TABS: { key: Tab; label: string; help: string }[] = [
  { key: 'board', label: 'To dos', help: 'Create, filter, schedule and edit the real task rows.' },
  { key: 'goals', label: 'Priorities', help: 'Shows why business tasks rank where they do. Every task opens its synced quick editor.' },
  { key: 'decisions', label: 'Decisions', help: 'Questions that hold work up. Each one is assigned to one of you, and every task linked to it reads as blocked until it is ruled.' },
  { key: 'queries', label: 'Queries', help: 'Questions that just want an answer. They block nothing, and each one is pinged into the Us thread the moment it is asked.' },
];

export default function Work() {
  const [tab, setTab] = useState<Tab>('board');
  const [newTask, setNewTask] = useState(false);
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
              {tab === 'board' && <BoardTab newOpen={newTask} setNewOpen={setNewTask} />}
              {tab === 'goals' && <GoalsTab />}
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
