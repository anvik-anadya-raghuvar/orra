import React, { useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { Course, CourseItem, ReadingItem } from '../../types';
import { newId, useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { entrance, spring, staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { Donut, MiniBars, Ring, VIZ } from '../../ui/viz';
import { ownRows } from '../../lib/workspace';
import {
  DeleteBtn,
  FixedDates,
  InlineText,
  LifeAdmin,
  MoveBtns,
  RelocationDocs,
  StudyRhythm,
  StudyTimer,
  TimeLedger,
  moveRows,
} from './widgets';
import { PersonalGoals, PersonalTasks } from './goals';
import MoodBoard from './moodboard';
import './personal.css';

/* ══════════════════════════════════════════════════════════════════════
   Courses — a ring per course, and every part of it editable in place.
   ══════════════════════════════════════════════════════════════════════ */

function CourseItemRow({ item, siblings, index }: { item: CourseItem; siblings: CourseItem[]; index: number }) {
  const store = useStore();
  const toast = useToast();

  return (
    <motion.div className="prow" variants={staggerItem}>
      <button
        className="bxbtn"
        type="button"
        aria-pressed={item.completed}
        aria-label={item.completed ? `Reopen ${item.title}` : `Complete ${item.title}`}
        onClick={() =>
          store.update(
            'course_items',
            item.id,
            { completed: !item.completed },
            store.asMe({ summary: `${item.title} ${!item.completed ? 'completed' : 'reopened'}` }),
          )
        }
      >
        <span className={`bx${item.completed ? ' on' : ''}`} aria-hidden />
      </button>
      <InlineText
        value={item.title}
        label="course item"
        className={`grow${item.completed ? ' off' : ''}`}
        onSave={(title) =>
          store.update('course_items', item.id, { title }, store.asMe({ summary: `Course item renamed — ${title}` }))
        }
      />
      <MoveBtns
        label={item.title}
        canUp={index > 0}
        canDown={index < siblings.length - 1}
        onUp={() => moveRows(store, 'course_items', siblings, index, index - 1)}
        onDown={() => moveRows(store, 'course_items', siblings, index, index + 1)}
      />
      <DeleteBtn
        label={item.title}
        onConfirm={() => {
          store.remove('course_items', item.id, store.asMe({ summary: `Course item removed — ${item.title}` }));
          toast('Item removed');
        }}
      />
    </motion.div>
  );
}

function CourseCard({ course, siblings, index }: { course: Course; siblings: Course[]; index: number }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [newItem, setNewItem] = useState('');

  const items = useMemo(
    () => ds.course_items.filter((ci) => ci.course_id === course.id).sort((a, b) => a.position - b.position),
    [ds.course_items, course.id],
  );
  const done = items.filter((i) => i.completed).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const addItem = () => {
    const title = newItem.trim();
    if (!title) return;
    store.insert(
      'course_items',
      { id: newId('ci'), course_id: course.id, title, completed: false, position: items.length + 1 },
      store.asMe({ summary: `Course item added — ${title}` }),
    );
    setNewItem('');
  };

  return (
    <motion.div className="pcourse" layout variants={staggerItem}>
      <div className="pchead">
        <span className="pcring">
          <Ring pct={pct} size={44} color={VIZ.cat[0]} label={`${course.title}, ${pct}% done`} />
          <em className="mono">{pct}%</em>
        </span>
        <span className="pctxt">
          <InlineText
            value={course.title}
            label="course title"
            className="pctitle"
            onSave={(title) => store.update('courses', course.id, { title }, store.asMe({ summary: `Course renamed — ${title}` }))}
          />
          <InlineText
            value={course.schedule_label}
            label="course schedule"
            placeholder="+ schedule"
            allowEmpty
            className="pcsched mono"
            onSave={(schedule_label) =>
              store.update('courses', course.id, { schedule_label }, store.asMe({ summary: `Schedule set — ${schedule_label}` }))
            }
          />
        </span>
        <span className="pcactions">
          <MoveBtns
            label={course.title}
            canUp={index > 0}
            canDown={index < siblings.length - 1}
            onUp={() => moveRows(store, 'courses', siblings, index, index - 1)}
            onDown={() => moveRows(store, 'courses', siblings, index, index + 1)}
          />
          <DeleteBtn
            label={course.title}
            onConfirm={() => {
              items.forEach((i) =>
                store.remove('course_items', i.id, store.asMe({ summary: `Course item removed with course — ${i.title}` })),
              );
              store.remove('courses', course.id, store.asMe({ summary: `Course removed — ${course.title}` }));
              toast('Course removed');
            }}
          />
          <button
            className="picon"
            type="button"
            aria-expanded={course.is_expanded}
            aria-label={`${course.is_expanded ? 'Collapse' : 'Expand'} ${course.title}`}
            onClick={() =>
              store.update('courses', course.id, { is_expanded: !course.is_expanded }, store.asMe({ silent: true }))
            }
          >
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              style={{ transform: course.is_expanded ? 'rotate(180deg)' : undefined, transition: 'transform .18s' }}
            />
          </button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {course.is_expanded && (
          <motion.div
            className="pcitems"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: entrance }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.16 } }}
          >
            <motion.div {...staggerParent()}>
              {items.map((it, i) => (
                <CourseItemRow key={it.id} item={it} siblings={items} index={i} />
              ))}
            </motion.div>
            <div className="paddrow">
              <input
                className="addin"
                placeholder="+ Add an item"
                value={newItem}
                aria-label={`New item for ${course.title}`}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addItem();
                  }
                }}
              />
              <button className="btn sm" type="button" onClick={addItem}>
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Courses() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState('');

  const meId = useData((_, s) => s.meId);
  const courses = useMemo(
    () => ownRows(ds.courses, meId).sort((a, b) => a.position - b.position),
    [ds.courses, meId],
  );

  const progress = useMemo(
    () =>
      courses.map((c) => {
        const items = ds.course_items.filter((ci) => ci.course_id === c.id);
        const done = items.filter((i) => i.completed).length;
        return { label: c.title, value: items.length ? Math.round((done / items.length) * 100) : 0, max: 100 };
      }),
    [courses, ds.course_items],
  );

  const add = () => {
    const t = title.trim();
    if (!t) return;
    store.insert(
      'courses',
      {
        id: newId('crs'),
        title: t,
        schedule_label: schedule.trim(),
        is_expanded: true,
        position: courses.length + 1,
        owner_id: meId,
      },
      store.asMe({ summary: `Course added — ${t}` }),
    );
    setTitle('');
    setSchedule('');
    toast('Course added');
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Courses</h3>
        <span className="eyebrow">tick items to move the ring</span>
      </div>

      {progress.length > 1 && (
        <div className="pbars">
          <MiniBars items={progress.map((p) => ({ ...p, color: VIZ.seq }))} format={(n) => `${n}%`} />
        </div>
      )}

      <motion.div {...staggerParent()} className="pcourses">
        {courses.map((c, i) => (
          <CourseCard key={c.id} course={c} siblings={courses} index={i} />
        ))}
      </motion.div>
      {courses.length === 0 && <p className="tip">No courses yet. Add the first one below.</p>}

      <div className="pform">
        <input
          className="addin"
          placeholder="Course title"
          value={title}
          aria-label="New course title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <input
          className="addin"
          placeholder="Schedule, e.g. Mon · Wed"
          value={schedule}
          aria-label="New course schedule"
          onChange={(e) => setSchedule(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn sm" type="button" onClick={add}>
          Add course
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Reading queue — a donut for the shape of it, everything else editable.
   ══════════════════════════════════════════════════════════════════════ */

const READ_CYCLE: ReadingItem['status'][] = ['queued', 'reading', 'done'];
const READ_PILL: Record<ReadingItem['status'], string> = { queued: 'q', reading: 'soon', done: 'ok' };

function ReadingQueue() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  const meId = useData((_, s) => s.meId);
  const rows = useMemo(
    () => ownRows(ds.reading_queue, meId).sort((a, b) => a.position - b.position),
    [ds.reading_queue, meId],
  );
  const counts = useMemo(
    () => READ_CYCLE.map((s) => ({ label: s, value: rows.filter((r) => r.status === s).length })),
    [rows],
  );

  const cycle = (r: ReadingItem) => {
    const next = READ_CYCLE[(READ_CYCLE.indexOf(r.status) + 1) % READ_CYCLE.length];
    store.update('reading_queue', r.id, { status: next }, store.asMe({ summary: `${r.title} → ${next}` }));
  };

  const add = () => {
    const t = title.trim();
    if (!t) return;
    store.insert(
      'reading_queue',
      {
        id: newId('rd'),
        title: t,
        author: author.trim(),
        status: 'queued',
        position: rows.length + 1,
        owner_id: meId,
      },
      store.asMe({ summary: `Reading item added — ${t}` }),
    );
    setTitle('');
    setAuthor('');
    toast('Added to the queue');
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Reading queue</h3>
        <span className="eyebrow">tap the pill to move it along</span>
      </div>

      <div className="preadtop">
        <Donut
          slices={counts.map((c, i) => ({ ...c, color: VIZ.cat[i] }))}
          size={92}
          centerValue={String(rows.length)}
          centerLabel="items"
        />
        <div className="viz-legend pcol">
          {counts.map((c, i) => (
            <span key={c.label}>
              <i style={{ background: VIZ.cat[i] }} />
              {c.label} · {c.value}
            </span>
          ))}
        </div>
      </div>

      <motion.div {...staggerParent()}>
        {rows.map((r, i) => (
          <motion.div className="prow" key={r.id} variants={staggerItem}>
            <span className="grow pstack">
              <InlineText
                value={r.title}
                label="reading title"
                onSave={(t) =>
                  store.update('reading_queue', r.id, { title: t }, store.asMe({ summary: `Reading renamed — ${t}` }))
                }
              />
              <InlineText
                value={r.author}
                label="author"
                placeholder="+ author"
                allowEmpty
                className="mono sub"
                onSave={(a) =>
                  store.update('reading_queue', r.id, { author: a }, store.asMe({ summary: `Author set — ${a || '—'}` }))
                }
              />
            </span>
            <button
              className={`pill ${READ_PILL[r.status]}`}
              type="button"
              aria-label={`${r.title} is ${r.status}, tap to advance`}
              onClick={() => cycle(r)}
            >
              {r.status}
            </button>
            <MoveBtns
              label={r.title}
              canUp={i > 0}
              canDown={i < rows.length - 1}
              onUp={() => moveRows(store, 'reading_queue', rows, i, i - 1)}
              onDown={() => moveRows(store, 'reading_queue', rows, i, i + 1)}
            />
            <DeleteBtn
              label={r.title}
              onConfirm={() => {
                store.remove('reading_queue', r.id, store.asMe({ summary: `Reading item removed — ${r.title}` }));
                toast('Removed');
              }}
            />
          </motion.div>
        ))}
        {rows.length === 0 && <p className="tip">Nothing queued.</p>}
      </motion.div>

      <div className="pform">
        <input
          className="addin"
          placeholder="Title"
          value={title}
          aria-label="New reading title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <input
          className="addin"
          placeholder="Author (optional)"
          value={author}
          aria-label="New reading author"
          onChange={(e) => setAuthor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn sm" type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The widgets this room can hold.
 *
 * Personal used to be built around one of the two lives — courses, a study
 * rhythm, a study timer — which left the other person looking at furniture.
 * Every widget is now optional and every person keeps their own set, so the
 * same room can be a degree tracker or a goals-and-agenda board.
 *
 * `col` is a hint, not a rule: the layout reflows when widgets are hidden.
 */
const WIDGETS: {
  key: string;
  label: string;
  hint: string;
  col: 'l' | 'r';
  node: React.ReactNode;
}[] = [
  { key: 'tasks', label: 'Personal tasks', hint: 'Your board’s personal rows, checkable here', col: 'l', node: <PersonalTasks /> },
  { key: 'goals', label: 'Goals', hint: 'Your own ambitions, with progress that fills itself in', col: 'l', node: <PersonalGoals /> },
  { key: 'courses', label: 'Courses', hint: 'Modules and their items, if you are studying', col: 'l', node: <Courses /> },
  { key: 'reading', label: 'Reading queue', hint: 'What you mean to read next', col: 'l', node: <ReadingQueue /> },
  { key: 'life_admin', label: 'Life admin', hint: 'The errands that are not tasks', col: 'l', node: <LifeAdmin /> },
  { key: 'rhythm', label: 'Study rhythm', hint: 'The 21-day strip and the study-vs-founder split', col: 'r', node: <StudyRhythm /> },
  { key: 'blocks', label: 'Blocks', hint: 'Start a study or personal block', col: 'r', node: <StudyTimer /> },
  { key: 'ledger', label: 'Time ledger', hint: 'Every logged block, editable', col: 'r', node: <TimeLedger /> },
  { key: 'dates', label: 'Fixed dates', hint: 'Flights, visas, term starts', col: 'r', node: <FixedDates /> },
  { key: 'docs', label: 'Relocation documents', hint: 'The paperwork with expiry dates', col: 'r', node: <RelocationDocs /> },
];

/** Everything on, until someone turns something off. */
const isOn = (widgets: Record<string, boolean> | undefined, key: string) => widgets?.[key] !== false;

function CustomisePersonal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const widgets = me.personalization.personal_widgets;

  const set = (key: string, value: boolean) =>
    store.update(
      'profiles',
      me.id,
      {
        personalization: {
          ...me.personalization,
          personal_widgets: { ...(widgets ?? {}), [key]: value },
        },
      },
      store.asMe({ summary: `Personal widget — ${key} ${value ? 'on' : 'off'}` }),
    );

  return (
    <Modal open={open} onClose={onClose} title="Customise Personal">
      <p className="tip" style={{ margin: '-6px 0 8px' }}>
        Yours only. This room has to fit two different lives — keep what matches yours and hide the
        rest. {store.other.name}&apos;s Personal is untouched by anything here.
      </p>
      {WIDGETS.map(({ key, label, hint }) => {
        const on = isOn(widgets, key);
        return (
          <div className="swrow" key={key}>
            <span className="txt">
              {label}
              <small>{hint}</small>
            </span>
            <button
              className="sw"
              role="switch"
              aria-checked={on}
              aria-label={label}
              onClick={() => {
                set(key, !on);
                toast(`${label} ${!on ? 'shown' : 'hidden'}`);
              }}
            >
              <motion.span className="knob" layout transition={spring} />
            </button>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn solid" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

type PersonalTab = 'dashboard' | 'board';

export default function Personal() {
  const me = useData((_, s) => s.me);
  const [tab, setTab] = useState<PersonalTab>('dashboard');
  const [customising, setCustomising] = useState(false);
  const widgets = me.personalization.personal_widgets;
  const shown = WIDGETS.filter((w) => isOn(widgets, w.key));

  return (
    <MotionConfig reducedMotion="user">
      <div className="personal-screen">
        <div className="frame">
          <div className="top">
            <div className="disp">Personal</div>
            <div className="ptabs" role="tablist" aria-label="Personal sections">
              <button role="tab" aria-selected={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
                Dashboard
              </button>
              <button role="tab" aria-selected={tab === 'board'} onClick={() => setTab('board')}>
                Mood board
              </button>
            </div>
            <div className="spacer" />
            {tab === 'dashboard' && (
              <button className="chip" type="button" onClick={() => setCustomising(true)}>
                Customise
              </button>
            )}
          </div>
          <div className="wrap">
            {tab === 'board' ? (
              <MoodBoard />
            ) : shown.length === 0 ? (
              <p className="tip">
                Every widget is hidden. Use Customise to bring back the ones that match your life.
              </p>
            ) : (
              <div className="pgrid2">
                <div className="pcol-l">
                  {shown.filter((w) => w.col === 'l').map((w) => (
                    <React.Fragment key={w.key}>{w.node}</React.Fragment>
                  ))}
                </div>
                <div className="pcol-r">
                  {shown.filter((w) => w.col === 'r').map((w) => (
                    <React.Fragment key={w.key}>{w.node}</React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <CustomisePersonal open={customising} onClose={() => setCustomising(false)} />
    </MotionConfig>
  );
}
