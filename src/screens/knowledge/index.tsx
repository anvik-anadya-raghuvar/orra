import { useState } from 'react';
import './style.css';
import NotesTab from './NotesTab';
import MailTab from './MailTab';
import DocumentsTab from './DocumentsTab';

type KTab = 'notes' | 'mail' | 'docs';

const TABS: { key: KTab; label: string }[] = [
  { key: 'notes', label: 'Notes' },
  { key: 'mail', label: 'Mail' },
  { key: 'docs', label: 'Documents' },
];

export default function Knowledge() {
  const [tab, setTab] = useState<KTab>('notes');

  return (
    <div className="frame">
      <div className="top">
        <div className="disp">Knowledge</div>
        <div className="sub2" role="tablist" aria-label="Knowledge sections">
          {TABS.map(({ key, label }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
      </div>
      <div className="wrap">
        {tab === 'notes' && <NotesTab />}
        {tab === 'mail' && <MailTab />}
        {tab === 'docs' && <DocumentsTab />}
      </div>
    </div>
  );
}
