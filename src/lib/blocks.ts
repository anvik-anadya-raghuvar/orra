/**
 * Category blocks — a slice of work, plus a clock.
 *
 * Replaces two unrelated timers: a 50-minute countdown that only ever wrapped
 * one task, and a study stopwatch that held its seconds in component state and
 * so lost the session on navigation or reload.
 *
 * Two rules make this work:
 *   1. Elapsed time is *derived* from `started_at`, never counted in the
 *      browser. The interval only forces a re-render; the number it shows
 *      would be identical after a reload, a tab sleep, or on another device.
 *   2. The task list is derived from the scope at render time, never stored.
 *      Close a task on the board and it leaves the block immediately —
 *      principle 10, one row and many views.
 */
import type { AppStore } from '../data/store';
import { inAnyProject, taskProjects } from './taskFacets';
import type { ActiveBlock, BlockScope, Dataset, Task, TimeLog, UserId } from '../types';
import { intentionsFor, itemDone } from './dayPlan';
import { myTasks } from './workspace';

export const FOUNDER_TARGET_MINUTES = 50;

export const SCOPE_COPY: Record<BlockScope, { label: string; blurb: string }> = {
  founder: { label: 'Founder block', blurb: 'Your startup work, nothing else.' },
  study: { label: 'Study block', blurb: 'The degree gets real hours.' },
  personal: { label: 'Personal block', blurb: 'Your own life, off the business clock.' },
  today_plan: { label: "Today's plan", blurb: 'Exactly what you committed to today.' },
  intentions: { label: 'Today is a win if…', blurb: "Today's intentions, start to finish." },
  custom: { label: 'Custom block', blurb: 'Your own timer, checklist and work category.' },
};

/** Which `time_logs.kind` a scope's hours belong to. */
export function logKind(scope: BlockScope, override?: TimeLog['kind'] | null): TimeLog['kind'] {
  if (scope === 'custom' && override) return override;
  if (scope === 'study') return 'study';
  // Personal hours stay out of the study-vs-founder split bar: an errand is
  // not founder time. Plan and intention blocks are founder work by nature.
  if (scope === 'personal') return 'personal';
  return 'founder';
}

/** My running block, if any. */
export function activeBlockFor(ds: Dataset, userId: UserId): ActiveBlock | null {
  return ds.active_blocks.find((b) => b.user_id === userId) ?? null;
}

/**
 * Seconds this block has actually been running — wall clock since it started,
 * minus everything spent paused. Pass `now` so callers and tests agree.
 */
export function elapsedSec(block: ActiveBlock, now: Date = new Date()): number {
  const started = new Date(block.started_at).getTime();
  const end = block.paused_at ? new Date(block.paused_at).getTime() : now.getTime();
  const raw = Math.floor((end - started) / 1000) - block.paused_total_sec;
  return Math.max(0, raw);
}

/** Minutes to log when the block ends. A block that ran at all counts as one. */
export function loggedMinutes(block: ActiveBlock, now: Date = new Date()): number {
  return Math.max(1, Math.round(elapsedSec(block, now) / 60));
}

/** MM:SS, counting up. Hours appear only once there are hours. */
export function clockLabel(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** How far through a target block is, 0–100. Null when it has no target. */
export function targetPct(block: ActiveBlock, now: Date = new Date()): number | null {
  if (!block.target_minutes) return null;
  return Math.min(100, (elapsedSec(block, now) / (block.target_minutes * 60)) * 100);
}

/** True once a targeted block has run its length. Open-ended blocks never are. */
export function targetReached(block: ActiveBlock, now: Date = new Date()): boolean {
  if (!block.target_minutes) return false;
  return elapsedSec(block, now) >= block.target_minutes * 60;
}

export interface BlockLine {
  /** Task id, or the intention row id for a typed line. */
  id: string;
  label: string;
  done: boolean;
  /** Present when this line stands for a real task. */
  taskId?: string;
  /** Present when it stands for a course item. */
  courseItemId?: string;
  /** Present when the line is a handwritten item owned by a custom block. */
  customItemId?: string;
}

/**
 * The work inside a block, derived live from its scope.
 *
 * Personal and founder split on `projects.is_personal` — the same fence the
 * ranking algorithm uses (principle 6), so the two never disagree about which
 * side a task is on.
 */
export function blockLines(ds: Dataset, block: ActiveBlock, todayIso: string): BlockLine[] {
  const personalProjects = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
  const mine = myTasks(ds.tasks, block.user_id);
  const openTask = (t: Task) => t.status !== 'done';

  const fromTasks = (list: Task[]): BlockLine[] =>
    list.map((t) => ({ id: t.id, taskId: t.id, label: t.title, done: t.status === 'done' }));

  switch (block.scope) {
    case 'custom':
      return (block.custom_items ?? []).map((item) => ({
        id: item.id,
        customItemId: item.id,
        label: item.text,
        done: item.done,
      }));
    case 'founder':
      return fromTasks(
        // A task in a business project AND a personal one belongs in both
        // block lists -- one row, many views (principle 10).
        mine.filter((t) => openTask(t) && taskProjects(t).some((id) => !personalProjects.has(id))),
      );
    case 'personal':
      return fromTasks(mine.filter((t) => openTask(t) && inAnyProject(t, personalProjects)));
    case 'study': {
      const courses = ds.courses.filter(
        (c) => (c.owner_id == null || c.owner_id === block.user_id) &&
          (!block.course_id || c.id === block.course_id),
      );
      const ids = new Set(courses.map((c) => c.id));
      return ds.course_items
        .filter((i) => ids.has(i.course_id) && !i.completed)
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ id: i.id, courseItemId: i.id, label: i.title, done: i.completed }));
    }
    case 'today_plan':
    case 'intentions': {
      const items = intentionsFor(ds, block.user_id, todayIso).filter((i) =>
        block.scope === 'today_plan' ? i.source === 'planner' : true,
      );
      return items.map((i) => ({
        id: i.id,
        taskId: i.task_id ?? undefined,
        label: i.task_id
          ? (ds.tasks.find((t) => t.id === i.task_id)?.title ?? i.text)
          : i.text,
        done: itemDone(i, ds.tasks),
      }));
    }
  }
}

/** The row a new block starts as. Kept pure so the caller owns the insert. */
export function newBlockRow(opts: {
  id: string;
  userId: UserId;
  scope: BlockScope;
  focusTaskId?: string | null;
  courseId?: string | null;
  startedAt?: string;
  targetMinutes?: number | null;
  customLabel?: string | null;
  customItems?: { id: string; text: string; done: boolean }[];
  logKind?: TimeLog['kind'] | null;
}): ActiveBlock {
  return {
    id: opts.id,
    user_id: opts.userId,
    scope: opts.scope,
    focus_task_id: opts.focusTaskId ?? null,
    course_id: opts.courseId ?? null,
    started_at: opts.startedAt ?? new Date().toISOString(),
    paused_at: null,
    paused_total_sec: 0,
    // Founder defaults to 50; custom blocks take the exact duration requested.
    target_minutes: opts.targetMinutes ?? (opts.scope === 'founder' ? FOUNDER_TARGET_MINUTES : null),
    custom_label: opts.customLabel ?? null,
    custom_items: opts.customItems ?? [],
    log_kind: opts.logKind ?? null,
  };
}

/**
 * Start a block, unless one is already running — the schema allows one row per
 * person and the UI should say so rather than fail at the database.
 * Returns false when a block was already live.
 */
export function startBlock(
  store: AppStore,
  scope: BlockScope,
  opts: {
    focusTaskId?: string | null;
    courseId?: string | null;
    targetMinutes?: number | null;
    customLabel?: string | null;
    customItems?: { id: string; text: string; done: boolean }[];
    logKind?: TimeLog['kind'] | null;
  } = {},
): boolean {
  if (activeBlockFor(store.ds, store.meId)) return false;
  store.insert(
    'active_blocks',
    newBlockRow({
      id: `ab-${store.meId}`,
      userId: store.meId,
      scope,
      focusTaskId: opts.focusTaskId ?? null,
      courseId: opts.courseId ?? null,
      targetMinutes: opts.targetMinutes,
      customLabel: opts.customLabel,
      customItems: opts.customItems,
      logKind: opts.logKind,
    }),
    store.asMe({ summary: `${SCOPE_COPY[scope].label} started` }),
  );
  return true;
}

/** The patch that resumes a paused block, folding the pause into the total. */
export function resumePatch(block: ActiveBlock, now: Date = new Date()): Partial<ActiveBlock> {
  if (!block.paused_at) return {};
  const paused = Math.floor((now.getTime() - new Date(block.paused_at).getTime()) / 1000);
  return { paused_at: null, paused_total_sec: block.paused_total_sec + Math.max(0, paused) };
}
