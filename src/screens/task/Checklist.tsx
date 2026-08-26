import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { newId, useData, useStore } from '../../data/store';
import { taskProgressPct } from '../../lib/checklist';
import { ProgressBar } from '../../ui/bits';
import { DictateField } from '../../ui/dictation';
import { staggerItem, staggerParent } from '../../ui/motion';
import type { Task } from '../../types';

/**
 * Subtasks rendered as a tick-box checklist. The same rows serve as the ops
 * task's main-column checklist and as the code-change task's sidebar subtasks —
 * one collection, two placements (principle 6: the type decides the placement).
 */
export default function Checklist({
  task,
  placeholder = '+ Add a step',
  showProgress = true,
}: {
  task: Task;
  placeholder?: string;
  showProgress?: boolean;
}) {
  const store = useStore();
  const items = useData((ds) =>
    ds.subtasks.filter((s) => s.task_id === task.id).sort((a, b) => a.position - b.position),
  );
  const [draft, setDraft] = useState('');

  const done = items.filter((s) => s.completed).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  /**
   * Push the task's percentage back in step with its checklist.
   *
   * Called after every add, tick and delete rather than only on tick,
   * because all three move the fraction — removing the one unticked step of
   * four is as much a completion as ticking it. `progress_pct` is what the
   * board card draws, and it had no human writer at all before this: the
   * only thing that ever set it was dragging a card to Done.
   */
  const syncProgress = (next: { completed: boolean }[]) => {
    const nextPct = taskProgressPct(task.description, next);
    if (nextPct !== null && nextPct !== task.progress_pct) {
      store.update('tasks', task.id, { progress_pct: nextPct }, store.asMe({ silent: true }));
    }
  };

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    const position = items.length ? Math.max(...items.map((s) => s.position)) + 1 : 1;
    store.insert(
      'subtasks',
      { id: newId('st'), task_id: task.id, title, completed: false, position },
      store.asMe({ summary: `Step added to ${task.id}: ${title}` }),
    );
    syncProgress([...items, { completed: false }]);
    setDraft('');
  };

  return (
    <div>
      {showProgress && items.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            className="mono"
            style={{ fontSize: 10, color: 'var(--mute)', marginBottom: 5 }}
          >
            {done}/{items.length} done · {pct}%
          </div>
          <ProgressBar pct={pct} grad="linear-gradient(90deg,var(--teal),var(--sky))" />
        </div>
      )}

      <motion.div {...staggerParent()}>
        <AnimatePresence initial={false}>
          {items.map((s) => (
            <motion.div
              key={s.id}
              className="sub"
              variants={staggerItem}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
              layout
            >
              <button
                className="tick"
                aria-pressed={s.completed}
                onClick={() => {
                  store.update('subtasks', s.id, { completed: !s.completed }, store.asMe());
                  syncProgress(items.map((r) => (r.id === s.id ? { completed: !r.completed } : r)));
                }}
              >
                <span className={`box${s.completed ? ' on' : ''}`} aria-hidden />
                <span className={s.completed ? 'done' : undefined}>{s.title}</span>
              </button>
              <button
                className="iconbtn danger"
                aria-label={`Delete step ${s.title}`}
                onClick={() => {
                  store.remove(
                    'subtasks',
                    s.id,
                    store.asMe({ summary: `Step removed from ${task.id}: ${s.title}` }),
                  );
                  syncProgress(items.filter((r) => r.id !== s.id));
                }}
              >
                <Trash2 size={15} strokeWidth={1.8} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {!items.length && <p className="none" style={{ marginBottom: 9 }}>Nothing on the list yet.</p>}

      <DictateField label="Dictate a step">
        <input
          className="addin"
          style={{ marginTop: 8 }}
          value={draft}
          placeholder={placeholder}
          aria-label="Add a step"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </DictateField>
    </div>
  );
}
