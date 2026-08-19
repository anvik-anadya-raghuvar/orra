import React, { useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { Course, CourseItem, ReadingItem } from '../../types';
import { newId, useData, useStore } from '../../data/store';
import { InfoTip, Modal, useToast } from '../../ui/bits';
import { entrance, spring, staggerItem, staggerParent } from '../../ui/motion';
import { Donut, MiniBars, Ring, VIZ } from '../../ui/viz';
import { myTasks, ownRows } from '../../lib/workspace';
import {
  DeleteBtn,
  FixedDates,
  InlineText,
  LabelEditor,
  LifeAdmin,
  MoveBtns,
  RelocationDocs,
  StudyRhythm,
  StudyTimer,
  TimeLedger,
  moveRows,
} from './widgets';
import { packBento } from '../../lib/bento';
import { arrange } from '../home/layout';
import { BentoTile, ResetArrangement, TileSheetHost, useHomeArrange } from '../home/tilechrome';
import '../home/style.css';
import { PersonalGoals, PersonalTasks } from './goals';
import {
  BlocksGlance,
  CoursesGlance,
  DatesGlance,
  DocsGlance,
  LedgerGlance,
  LifeAdminGlance,
  OrdersGlance,
  ReadingGlance,
  RhythmGlance,
  TasksGlance,
} from './glances';
import { CalendarGlance, PersonalCalendar } from './calendar';
import MoodBoard from './moodboard';
import { daysUntil, todayIso } from '../../lib/dates';
import { isTerminalOrder } from '../../lib/personalOrders';
import { goalsFor } from '../../lib/goals';
import PersonalOrders from './PersonalOrders';
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

      <LabelEditor
        values={course.tags ?? []}
        label={`Labels for ${course.title}`}
        onChange={(tags) =>
          store.update('courses', course.id, { tags }, store.asMe({ summary: `Labels updated — ${course.title}` }))
        }
      />

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
        tags: [],
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
        tags: [],
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
              <LabelEditor
                values={r.tags ?? []}
                label={`Labels for ${r.title}`}
                onChange={(tags) =>
                  store.update('reading_queue', r.id, { tags }, store.asMe({ summary: `Labels updated — ${r.title}` }))
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
/**
 * Where a widget sits.
 *
 * Ten widgets on one screen was a wall — you could not see any of them because
 * you were looking at all of them. They group naturally into three moods, so
 * the room now has three, and each holds three or four tiles that have space
 * to be legible.
 *
 * A tab is not a permission and not a filter on someone else's data: it is
 * where your own widgets live. A tab whose widgets you have all switched off
 * disappears rather than showing you an empty room.
 */
export type WidgetTab = 'today' | 'learning' | 'plans';

export const TAB_META: { key: WidgetTab; label: string; blurb: string }[] = [
  { key: 'today', label: 'Today', blurb: 'What you are actually doing with the day.' },
  { key: 'learning', label: 'Learning', blurb: 'Courses, reading and where the hours went.' },
  { key: 'plans', label: 'Plans', blurb: 'Orders, dates, errands and relocation paperwork.' },
];

/**
 * The widgets this room can hold.
 *
 * Personal used to be built around one of the two lives — courses, a study
 * rhythm, a study timer — which left the other person looking at furniture.
 * Every widget is now optional and every person keeps their own set, so the
 * same room can be a degree tracker or a goals-and-agenda board.
 *
 * `cols`/`rows` are hints, not rules: the packer closes any gap and a drag or
 * resize overrides them per person.
 *
 * Two faces per widget, on purpose:
 *   `glance` — what the TILE shows. A fixed-shape, view-only summary that can
 *              never outgrow its box, so tiles never scroll and never steal
 *              the wheel from the page.
 *   `node`   — the full working widget, which lives on the SIDE PAGE the tile
 *              opens: every list, add-form and button, at full height.
 */
const WIDGETS: {
  key: string;
  label: string;
  hint: string;
  tab: WidgetTab;
  cols: 1 | 2 | 4;
  rows?: 1 | 2;
  glance: React.ReactNode;
  node: React.ReactNode;
}[] = [
  { key: 'tasks', label: 'Personal tasks', hint: 'Your board’s personal rows, checkable here', tab: 'today', cols: 2, glance: <TasksGlance />, node: <PersonalTasks /> },
  { key: 'calendar', label: 'Calendar', hint: 'Your month — personal due dates, fixed dates, blocks and trips on one grid', tab: 'today', cols: 2, rows: 2, glance: <CalendarGlance />, node: <PersonalCalendar /> },
  { key: 'blocks', label: 'Focus blocks', hint: 'Start a study or personal block', tab: 'today', cols: 2, glance: <BlocksGlance />, node: <StudyTimer /> },
  { key: 'courses', label: 'Courses', hint: 'Modules and their items, if you are studying', tab: 'learning', cols: 2, glance: <CoursesGlance />, node: <Courses /> },
  { key: 'reading', label: 'Reading queue', hint: 'What you mean to read next', tab: 'learning', cols: 2, glance: <ReadingGlance />, node: <ReadingQueue /> },
  { key: 'rhythm', label: 'Study rhythm', hint: 'The 21-day strip and the study-vs-founder split', tab: 'learning', cols: 2, glance: <RhythmGlance />, node: <StudyRhythm /> },
  { key: 'ledger', label: 'Time ledger', hint: 'Every logged block, editable', tab: 'learning', cols: 2, glance: <LedgerGlance />, node: <TimeLedger /> },
  { key: 'orders', label: 'Orders & travel', hint: 'Review purchases, deliveries and bookings', tab: 'plans', cols: 2, glance: <OrdersGlance />, node: <PersonalOrders /> },
  { key: 'personal_admin', label: 'Personal admin', hint: 'Small errands that are not project tasks', tab: 'plans', cols: 2, glance: <LifeAdminGlance />, node: <LifeAdmin /> },
  { key: 'dates', label: 'Fixed dates', hint: 'Flights, visas and term starts', tab: 'plans', cols: 2, glance: <DatesGlance />, node: <FixedDates /> },
  { key: 'docs', label: 'Relocation documents', hint: 'Paperwork with expiry dates', tab: 'plans', cols: 2, glance: <DocsGlance />, node: <RelocationDocs /> },
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
        Pick what this room tracks for you. Every switch below is a widget — on means it shows on
        your dashboard, off means it is gone. {store.other.name}&apos;s Personal is untouched by
        anything here, and a tab whose widgets are all off stops appearing.
      </p>
      {TAB_META.map((t) => (
        <React.Fragment key={t.key}>
          <div className="eyebrow" style={{ margin: '14px 0 4px' }}>
            {t.label}
          </div>
          {WIDGETS.filter((w) => w.tab === t.key).map(({ key, label, hint }) => {
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
        </React.Fragment>
      ))}
      <div className="eyebrow" style={{ margin: '18px 0 4px' }}>
        Arrangement
      </div>
      <ResetArrangement field="personal_layout" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn solid" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/**
 * The dashboard grid — the same bento Home uses, against Personal's own stored
 * arrangement. Drag by the grip, resize from the corner or the expand sheet,
 * and it is per person like everything else in this room.
 */
function PersonalBento({ shown }: { shown: typeof WIDGETS }) {
  const api = useHomeArrange('personal_layout');
  const laid = arrange(
    shown.map((w) => ({ ...w, cols: w.cols as number, rows: w.rows ?? 1 })),
    api.layout,
  );
  api.syncKeys(laid.map((t) => t.key));

  const { rc4, rc2 } = useMemo(
    () => packBento(laid.map((t) => ({ key: t.key, cols: t.cols, rows: t.rows }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [laid.map((t) => `${t.key}:${t.cols}x${t.rows}`).join(',')],
  );

  return (
    <div className="home-screen">
      <motion.div className="bento" ref={api.gridRef} {...staggerParent()}>
        {laid.map((t) => (
          <BentoTile
            key={t.key}
            tileKey={t.key}
            span={{ cols: t.cols, rows: t.rows }}
            api={api}
            className="bt"
            style={
              {
                '--rc4': rc4.get(t.key)?.renderCols ?? t.cols,
                '--rr4': rc4.get(t.key)?.renderRows ?? t.rows,
                '--gc4': rc4.get(t.key)?.col ?? 'auto',
                '--gr4': rc4.get(t.key)?.row ?? 'auto',
                '--rc2': rc2.get(t.key)?.renderCols ?? Math.min(t.cols, 2),
                '--rr2': rc2.get(t.key)?.renderRows ?? t.rows,
                '--gc2': rc2.get(t.key)?.col ?? 'auto',
                '--gr2': rc2.get(t.key)?.row ?? 'auto',
              } as React.CSSProperties
            }
          >
            {/* The whole tile is the door. What it shows is a glance — fixed
                shape, view only, nothing to scroll — and one tap anywhere on
                it opens the side page where the full widget actually works. */}
            <button
              type="button"
              className="pglance-hit"
              onClick={() => api.setOpenKey(t.key)}
              aria-label={`Open ${t.label}`}
            >
              {t.glance}
            </button>
          </BentoTile>
        ))}
      </motion.div>
      <TileSheetHost
        api={api}
        tiles={laid.map((t) => ({
          key: t.key,
          title: t.label,
          span: { cols: t.cols, rows: t.rows },
          node: t.node,
        }))}
      />
    </div>
  );
}

type PersonalTab = WidgetTab | 'goals' | 'vision';

const PERSONAL_TABS: { key: PersonalTab; label: string; blurb: string }[] = [
  { key: 'today', label: 'Today', blurb: 'Your current direction and the personal work you can act on now.' },
  { key: 'goals', label: 'Goals', blurb: 'Personal directions with a reason, next action and honest progress.' },
  { key: 'learning', label: 'Learning', blurb: 'Courses, reading and the hours you are putting in.' },
  { key: 'plans', label: 'Plans', blurb: 'Orders, travel, fixed dates, errands and relocation paperwork.' },
  { key: 'vision', label: 'Vision', blurb: 'A private place for images, references, notes and songs.' },
];

function PersonalToday({
  onOpen,
  onCreateGoal,
  widgets,
}: {
  onOpen: (tab: PersonalTab) => void;
  onCreateGoal: () => void;
  widgets: typeof WIDGETS;
}) {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const personalProjects = useMemo(
    () => new Set(ds.projects.filter((project) => project.is_personal).map((project) => project.id)),
    [ds.projects],
  );
  const actions = useMemo(
    () =>
      myTasks(ds.tasks, meId).filter(
        (task) => personalProjects.has(task.project_id) && task.status !== 'done',
      ),
    [ds.tasks, meId, personalProjects],
  );
  const goals = useMemo(
    () => goalsFor(ds, meId).filter((goal) => goal.status === 'open'),
    [ds.personal_goals, meId],
  );
  const focus = goals.find((goal) => (goal.focus_state ?? 'now') === 'now') ?? goals[0];
  const nextDate = useMemo(
    () =>
      [...ds.fixed_dates]
        .map((item) => ({ ...item, days: daysUntil(item.date, todayIso()) }))
        .filter((item) => item.days >= 0)
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [ds.fixed_dates],
  );
  const myOrders = useMemo(
    () => ds.personal_orders.filter((order) => order.user_id === meId),
    [ds.personal_orders, meId],
  );
  const pendingOrders = myOrders.filter((order) => order.review_status === 'pending');
  const activeDeliveries = myOrders.filter(
    (order) => order.review_status === 'confirmed' && order.kind === 'physical' && !isTerminalOrder(order),
  );
  const upcomingTrips = myOrders.filter(
    (order) => order.review_status === 'confirmed' && order.kind === 'travel' && !isTerminalOrder(order),
  );

  return (
    <div className="life-workspace">
      <section className="life-focus" aria-label="Personal summary for today">
        <span className="eyebrow">Personal briefing · today</span>
        <h1>{focus?.title ?? 'What would make the next 90 days meaningfully better?'}</h1>
        <p>
          {focus?.next_action ||
            (focus
              ? 'Give this goal one concrete next action so it can move today.'
              : 'Start with one direction. You do not need to design everything first.')}
        </p>
        <div className="life-focus-actions">
          <button className="btn solid" type="button" onClick={focus ? () => onOpen('goals') : onCreateGoal}>
            {focus ? 'Open this goal' : 'Create your first goal'}
          </button>
          <button className="btn" type="button" onClick={() => onOpen('plans')}>
            Review plans
          </button>
        </div>
        <div className="life-signal-grid">
          <div>
            <b>{actions.length}</b>
            <span>next actions</span>
          </div>
          <button type="button" onClick={() => onOpen('goals')}>
            <b>{goals.length}</b>
            <span>active goals</span>
          </button>
          <button type="button" onClick={() => onOpen('plans')}>
            <b>{nextDate ? nextDate.days : '—'}</b>
            <span>{nextDate ? `days to ${nextDate.label}` : 'no fixed date'}</span>
          </button>
        </div>
        <button className="life-order-radar" type="button" onClick={() => onOpen('plans')}>
          <span><b>{pendingOrders.length}</b><i>orders to review</i></span>
          <span><b>{activeDeliveries.length}</b><i>active deliveries</i></span>
          <span><b>{upcomingTrips.length}</b><i>upcoming trips</i></span>
        </button>
      </section>
      {widgets.length ? (
        <PersonalBento shown={widgets} />
      ) : (
        <p className="tip">Today’s widgets are hidden. Use Customise to bring one back.</p>
      )}
    </div>
  );
}

export default function Personal() {
  const me = useData((_, s) => s.me);
  const [tab, setTab] = useState<PersonalTab>('today');
  const [goalComposerToken, setGoalComposerToken] = useState(0);
  const [customising, setCustomising] = useState(false);
  const meta = PERSONAL_TABS.find((item) => item.key === tab)!;
  const shown = useMemo(
    () => WIDGETS.filter((widget) => isOn(me.personalization.personal_widgets, widget.key)),
    [me.personalization.personal_widgets],
  );
  const sectionWidgets = shown.filter(
    (widget) => tab !== 'goals' && tab !== 'vision' && widget.tab === tab,
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="personal-screen">
        <div className="frame">
          <div className="top life-top">
            <div>
              <div className="disp feature-label">
                Personal
                <InfoTip label={meta.label} text={meta.blurb} />
              </div>
            </div>
            <div className="ptabs" role="tablist" aria-label="Personal sections">
              {PERSONAL_TABS.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  type="button"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="chip" type="button" onClick={() => setCustomising(true)}>
              Customise
            </button>
          </div>
          <div className="wrap life-wrap">
            {tab === 'today' && (
              <PersonalToday
                onOpen={setTab}
                widgets={sectionWidgets}
                onCreateGoal={() => {
                  setGoalComposerToken((token) => token + 1);
                  setTab('goals');
                }}
              />
            )}
            {tab === 'goals' && (
              <section className="life-card wide">
                <PersonalGoals openComposerToken={goalComposerToken} />
              </section>
            )}
            {(tab === 'learning' || tab === 'plans') && (
              sectionWidgets.length ? (
                <PersonalBento key={tab} shown={sectionWidgets} />
              ) : (
                <p className="tip">Every widget in this section is hidden. Use Customise to bring one back.</p>
              )
            )}
            {tab === 'vision' && <MoodBoard />}
          </div>
        </div>
      </div>
      <CustomisePersonal open={customising} onClose={() => setCustomising(false)} />
    </MotionConfig>
  );
}
