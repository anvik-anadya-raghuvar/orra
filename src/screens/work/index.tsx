import React, { useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { entrance, micro } from '../../ui/motion';
import BoardTab from './board';
import GoalsTab from './goals';
import DecisionsTab from './decisions';
import './work.css';

type Tab = 'board' | 'goals' | 'decisions';

const TABS: { key: Tab; label: string }[] = [
  { key: 'board', label: 'Board' },
  { key: 'goals', label: 'Goals' },
  { key: 'decisions', label: 'Decisions' },
];

export default function Work() {
  const [tab, setTab] = useState<Tab>('board');
  const [newTask, setNewTask] = useState(false);
  const [newDecision, setNewDecision] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <div className="frame">
        <div className="top">
          <div className="disp">Work</div>
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
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
