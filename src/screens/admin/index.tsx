import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { entrance, micro } from '../../ui/motion';
import TrailTab from './TrailTab';
import RulesTab from './RulesTab';
import TagsTab from './TagsTab';
import ConnectionsTab from './ConnectionsTab';
import DataTab from './DataTab';
import './admin.css';

type Tab = 'trail' | 'rules' | 'tags' | 'connections' | 'data';

const TABS: { key: Tab; label: string }[] = [
  { key: 'trail', label: 'Trail' },
  { key: 'rules', label: 'Rules' },
  { key: 'tags', label: 'Tags' },
  { key: 'connections', label: 'Connections' },
  { key: 'data', label: 'Data' },
];

export default function Admin() {
  const [tab, setTab] = useState<Tab>('trail');

  return (
    <div className="admin-screen frame">
      <div className="top">
        <div className="disp">Admin</div>
        <div className="sub2" role="tablist" aria-label="Admin sections">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              id={`ad-tab-${key}`}
              aria-controls="ad-panel"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
      </div>
      <div className="wrap" id="ad-panel" role="tabpanel" aria-labelledby={`ad-tab-${tab}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: entrance }}
            exit={{ opacity: 0, y: 6, transition: micro }}
          >
            {tab === 'trail' && <TrailTab />}
            {tab === 'rules' && <RulesTab />}
            {tab === 'tags' && <TagsTab />}
            {tab === 'connections' && <ConnectionsTab />}
            {tab === 'data' && <DataTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
