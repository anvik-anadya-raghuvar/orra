import React, { useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { Course, CourseItem, ReadingItem } from '../../types';
import { newId, useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance, staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { Donut, MiniBars, Ring, VIZ } from '../../ui/viz';
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

  const courses = useMemo(() => [...ds.courses].sort((a, b) => a.position - b.position), [ds.courses]);

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
      { id: newId('crs'), title: t, schedule_label: schedule.trim(), is_expanded: true, position: courses.length + 1 },
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

  const rows = useMemo(() => [...ds.reading_queue].sort((a, b) => a.position - b.position), [ds.reading_queue]);
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
      { id: newId('rd'), title: t, author: author.trim(), status: 'queued', position: rows.length + 1 },
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

export default function Personal() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="personal-screen">
        <div className="frame">
          <div className="top">
            <div className="disp">Personal</div>
            <div className="spacer" />
            <span className="eyebrow">the degree, the move, and the rest of your life</span>
          </div>
          <div className="wrap">
            <div className="pgrid2">
              <div className="pcol-l">
                <Courses />
                <ReadingQueue />
                <LifeAdmin />
              </div>
              <div className="pcol-r">
                <StudyRhythm />
                <StudyTimer />
                <TimeLedger />
                <FixedDates />
                <RelocationDocs />
              </div>
            </div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
