import { useState } from 'react';
import './style.css';
import NotesTab from './NotesTab';
import MailTab from './MailTab';
import DocumentsTab from './DocumentsTab';
import WikiTab from './WikiTab';
import { InfoTip } from '../../ui/bits';
import { takeJump } from '../../lib/jump';

type KTab = 'notes' | 'wiki' | 'mail' | 'docs';

const TABS: { key: KTab; label: string; help: string }[] = [
  { key: 'notes', label: 'Scribbles', help: 'Fast notes, checklists, meeting notes and voice captures.' },
  { key: 'wiki', label: 'Wiki', help: 'Structured pages you write down to keep and navigate later.' },
  { key: 'mail', label: 'Mail', help: 'Connected mail that can become tasks, notes or decisions.' },
  { key: 'docs', label: 'Documents', help: 'Documents with owners, expiry dates and follow-up status.' },
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
  /**
   * The palette can send you straight to a page or a scribble, and this room
   * keeps its tab in local state with no URL of its own. Read once, in the
   * initialiser rather than an effect, so the right tab is what first paints
   * instead of Scribbles flashing before the switch.
   */
  const [jump] = useState(takeJump);
  const [tab, setTab] = useState<KTab>(jump?.knowledgeTab ?? 'notes');

  return (
    <div className="frame">
      <div className="top">
        <div className="disp feature-label">
          Notebook
          <InfoTip label={TABS.find((item) => item.key === tab)!.label} text={TABS.find((item) => item.key === tab)!.help} />
        </div>
        <div className="sub2" role="tablist" aria-label="Notebook sections">
          {TABS.map(({ key, label }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
      </div>
      <div className="wrap">
        {tab === 'notes' && <NotesTab initialQuery={jump?.query} />}
        {tab === 'wiki' && <WikiTab initialPageId={jump?.pageId} />}
        {tab === 'mail' && <MailTab />}
        {tab === 'docs' && <DocumentsTab />}
      </div>
    </div>
  );
}
