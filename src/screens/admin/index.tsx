import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { entrance, micro } from '../../ui/motion';
import TrailTab from './TrailTab';
import RulesTab from './RulesTab';
import TagsTab from './TagsTab';
import ConnectionsTab from './ConnectionsTab';
import DataTab from './DataTab';
import './admin.css';
import { InfoTip } from '../../ui/bits';

type Tab = 'trail' | 'rules' | 'tags' | 'connections' | 'data';

const TABS: { key: Tab; label: string; help: string }[] = [
  { key: 'trail', label: 'Trail', help: 'A chronological record of meaningful changes in the workspace.' },
  { key: 'rules', label: 'Rules', help: 'Automation rules that classify or route incoming information.' },
  { key: 'tags', label: 'Tags', help: 'The shared label library; task editors can also create labels inline.' },
  { key: 'connections', label: 'Connections', help: 'External accounts connected to the workspace and their sync state.' },
  { key: 'data', label: 'Data', help: 'Import, export, trash and maintenance tools for workspace data.' },
];

export default function Admin() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get('tab');
    return TABS.some((item) => item.key === requested) ? requested as Tab : 'trail';
  });

  return (
    <div className="admin-screen frame">
      <div className="top">
        <div className="disp feature-label">
          Settings
          <InfoTip label={TABS.find((item) => item.key === tab)!.label} text={TABS.find((item) => item.key === tab)!.help} />
        </div>
        <div className="sub2" role="tablist" aria-label="Settings sections">
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
