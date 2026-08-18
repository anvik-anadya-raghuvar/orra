import React, { useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { Course, ReadingItem } from '../../types';
import { newId, useData, useStore } from '../../data/store';
import { entrance, staggerItem, staggerList } from '../../ui/motion';
import { SplitBar, StudyTimer, LifeAdmin, FixedDates, RelocationDocs } from './widgets';
import './personal.css';

/* ── courses — expandable, progress driven by their items ──────────────── */
function CourseCard({ course }: { course: Course }) {
  const ds = useData((d) => d);
  const store = useStore();
  const [newItem, setNewItem] = useState('');

  const items = useMemo(
    () => ds.course_items.filter((ci) => ci.course_id === course.id).sort((a, b) => a.position - b.position),
    [ds.course_items, course.id],
  );
  const pct = items.length ? Math.round((items.filter((i) => i.completed).length / items.length) * 100) : 0;

  const toggleExpand = () => {
    store.update('courses', course.id, { is_expanded: !course.is_expanded }, store.asMe({ silent: true }));
  };

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
      <button className="pchead" type="button" onClick={toggleExpand} aria-expanded={course.is_expanded}>
        <span className="pctxt">
          <b>{course.title}</b>
          <span className="mono">{course.schedule_label}</span>
        </span>
        <span className="pcbar">
          <div style={{ height: 6, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: '100%', background: 'linear-gradient(90deg,var(--sky),var(--indigo))' }}
            />
          </div>
        </span>
        <span className="pcpct mono">{pct}%</span>
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          style={{ transform: course.is_expanded ? 'rotate(180deg)' : undefined, transition: 'transform .2s', flex: 'none' }}
        />
      </button>
      <AnimatePresence initial={false}>
        {course.is_expanded && (
          <motion.div
            className="pcitems"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: entrance }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.16 } }}
          >
            {items.map((it) => (
              <button
                key={it.id}
                className="check"
                type="button"
                onClick={() =>
                  store.update(
                    'course_items',
                    it.id,
                    { completed: !it.completed },
                    store.asMe({ summary: `${it.title} ${!it.completed ? 'completed' : 'reopened'}` }),
                  )
                }
              >
                <span className={`bx${it.completed ? ' on' : ''}`} aria-hidden />
                <span className={it.completed ? 'off' : ''}>{it.title}</span>
              </button>
            ))}
            <input
              className="addin"
              placeholder="+ Add an item"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addItem();
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── reading queue — tap the pill to cycle its status ───────────────────── */
const READ_CYCLE: ReadingItem['status'][] = ['queued', 'reading', 'done'];
const READ_PILL: Record<ReadingItem['status'], string> = { queued: 'q', reading: 'soon', done: 'ok' };

function ReadingQueue() {
  const ds = useData((d) => d);
  const store = useStore();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  const cycle = (r: ReadingItem) => {
    const next = READ_CYCLE[(READ_CYCLE.indexOf(r.status) + 1) % READ_CYCLE.length];
    store.update('reading_queue', r.id, { status: next }, store.asMe({ summary: `${r.title} → ${next}` }));
  };

  const add = () => {
    if (!title.trim()) return;
    store.insert(
      'reading_queue',
      { id: newId('rd'), title: title.trim(), author: author.trim(), status: 'queued', position: ds.reading_queue.length + 1 },
      store.asMe({ summary: `Reading item added — ${title.trim()}` }),
    );
    setTitle('');
    setAuthor('');
  };

  return (
    <div>
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>
        Reading queue · tap the pill to move it along
      </div>
      <motion.div variants={staggerList} initial="initial" animate="animate">
        {ds.reading_queue.map((r) => (
          <motion.div className="prow" key={r.id} variants={staggerItem}>
            <span style={{ flex: 1 }}>
              {r.title}
              {r.author && (
                <span className="mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--mute)' }}>
                  {r.author}
                </span>
              )}
            </span>
            <button className={`pill ${READ_PILL[r.status]}`} type="button" onClick={() => cycle(r)}>
              {r.status}
            </button>
          </motion.div>
        ))}
      </motion.div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <input className="addin" placeholder="Title" value={title} style={{ flex: '1 1 140px' }} onChange={(e) => setTitle(e.target.value)} />
        <input
          className="addin"
          placeholder="Author (optional)"
          value={author}
          style={{ flex: '1 1 120px' }}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <button className="btn sm" type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

export default function Personal() {
  const ds = useData((d) => d);
  const courses = useMemo(() => [...ds.courses].sort((a, b) => a.position - b.position), [ds.courses]);

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
              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>
                  Courses · tick items to move the bar
                </div>
                <motion.div variants={staggerList} initial="initial" animate="animate">
                  {courses.map((c) => (
                    <CourseCard key={c.id} course={c} />
                  ))}
                </motion.div>
                <ReadingQueue />
                <div style={{ height: 6 }} />
                <LifeAdmin />
              </div>
              <div>
                <SplitBar />
                <StudyTimer />
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
