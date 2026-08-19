import { useState } from 'react';
import './style.css';
import NotesTab from './NotesTab';
import MailTab from './MailTab';
import DocumentsTab from './DocumentsTab';
import WikiTab from './WikiTab';

type KTab = 'notes' | 'wiki' | 'mail' | 'docs';

const TABS: { key: KTab; label: string }[] = [
  { key: 'notes', label: 'Scribbles' },
  { key: 'wiki', label: 'Wiki' },
  { key: 'mail', label: 'Mail' },
  { key: 'docs', label: 'Documents' },
];

/**
 * The room used to be called Knowledge, which named the ambition rather than
 * the thing, and left "how is a note different from a wiki page?" for you to
 * work out from the two tabs alone. It is a Notebook now, the quick half is
 * Scribbles, and the line below says the split out loud — because a good name
 * can suggest the difference but it cannot teach it.
 *
 * The route stays /knowledge: it is not something either of us reads, and
 * changing it would break every link already written into a task or a page.
 */
export default function Knowledge() {
  const [tab, setTab] = useState<KTab>('notes');

  return (
    <div className="frame">
      <div className="top">
        <div className="disp">Notebook</div>
        <div className="sub2" role="tablist" aria-label="Notebook sections">
          {TABS.map(({ key, label }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
      </div>
      {/* Its own band rather than a third item in `.top`: that row is a
          wrapping flex line, and a paragraph with a readable measure is narrow
          enough to fit beside the tabs, so it landed there instead of under
          them however the basis was set. */}
      <p className="kn-blurb">
        <span>
          Scribbles are what you jot down fast. The wiki is what you write down to keep. Documents
          are the ones with dates on them.
        </span>
      </p>
      <div className="wrap">
        {tab === 'notes' && <NotesTab />}
        {tab === 'wiki' && <WikiTab />}
        {tab === 'mail' && <MailTab />}
        {tab === 'docs' && <DocumentsTab />}
      </div>
    </div>
  );
}
