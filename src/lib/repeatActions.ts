/**
 * Creating the next occurrence of a repeating task.
 *
 * Split from repeat.ts because that file is pure and node-testable, and this
 * one has to touch the store — the same division handoff.ts makes, and for
 * the same reason: the arithmetic is where the bugs would be, so it stays
 * somewhere a test can reach.
 */
import type { AppStore } from '../data/store';
import type { Task } from '../types';
import { makeTask } from './taskFactory';
import { todayIso } from './dates';
import { nextOccurrenceFields, normalizeRepeat } from './repeat';

/**
 * Mint the next occurrence, or return null when there is nothing to mint.
 *
 * Called at the moment a task becomes done — which is also why deleting or
 * trashing a repeating task quietly ends the chain: nothing else in the app
 * ever creates one of these.
 */
export function spawnNextOccurrence(store: AppStore, task: Task, today = todayIso()): Task | null {
  if (!normalizeRepeat(task.repeat)) return null;
  const fields = nextOccurrenceFields(task, today);
  const next = makeTask({
    ...fields,
    id: store.nextTaskId(),
    title: task.title,
    project_id: task.project_id,
    created_by: store.meId,
  });
  return store.insert(
    'tasks',
    next,
    // Named in the trail with both ids, so the chain is followable a year
    // later without guessing which row came from which.
    store.asMe({ summary: `Repeat — ${next.id} created from ${task.id}, due ${next.due_date}` }),
  );
}
