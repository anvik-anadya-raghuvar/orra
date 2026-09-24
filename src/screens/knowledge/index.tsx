import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import './style.css';
import NotesTab from './NotesTab';
import MailTab from './MailTab';
import DocumentsTab from './DocumentsTab';
import WikiTab from './WikiTab';
import { InfoTip } from '../../ui/bits';
import { takeJump, type Jump } from '../../lib/jump';

type KTab = 'notes' | 'wiki' | 'mail' | 'docs';

const isKTab = (value: string | null | undefined): value is KTab =>
  value === 'notes' || value === 'wiki' || value === 'mail' || value === 'docs';

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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [jump, setJumpNote] = useState<Jump | null>(takeJump);
  const [tab, setTab] = useState<KTab>(() => {
    const fromUrl = searchParams.get('tab');
    return jump?.knowledgeTab ?? (isKTab(fromUrl) ? fromUrl : 'notes');
  });
  /** Bumped on every arrival after the first, so a tab whose props are only
   *  read on mount (a prefilled query, a selected page) remounts with them. */
  const [arrival, setArrival] = useState(0);

  /**
   * Ctrl+K while already standing in the Notebook changes the URL's key but
   * does not remount this screen, so the initialiser above never re-reads the
   * note — it would sit in sessionStorage until some later, unrelated visit.
   * Re-read on every navigation instead. The first run is skipped because the
   * initialiser already consumed that arrival's note.
   */
  const mounted = useRef(false);
  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const note = takeJump();
    const nextTab = note?.knowledgeTab ?? (isKTab(tabParam) ? tabParam : null);
    if (!note && !nextTab) return;
    setJumpNote(note);
    if (nextTab) setTab(nextTab);
    setArrival((n) => n + 1);
    // location.key is the trigger: a fresh navigation, even to the same URL.
  }, [location.key]);

  return (
    <div className="frame">
      <div className="top">
        <div className="disp feature-label">
          Notebook
          <InfoTip label={TABS.find((item) => item.key === tab)!.label} text={TABS.find((item) => item.key === tab)!.help} />
        </div>
        <div className="sub2" role="tablist" aria-label="Notebook sections">
          {TABS.map(({ key, label }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => {
                // A tab picked by hand starts clean, not with the last jump's query.
                setJumpNote(null);
                setTab(key);
              }}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
      </div>
      <div className="wrap">
        {tab === 'notes' && (
          <NotesTab
            key={arrival}
            initialQuery={jump?.query}
            initialCompose={searchParams.get('compose') === '1'}
          />
        )}
        {tab === 'wiki' && <WikiTab key={arrival} initialPageId={jump?.pageId} />}
        {tab === 'mail' && <MailTab />}
        {tab === 'docs' && <DocumentsTab key={arrival} initialQuery={jump?.query} />}
      </div>
    </div>
  );
}
