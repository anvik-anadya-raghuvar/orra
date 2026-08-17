import type { Dataset, Task } from '../types';

export interface RankedTask {
  task: Task;
  objectiveFit: number; // 0–100 before weighting
  unblocks: number;
  deadline: number;
  score: number; // weighted total, 0–100
  why: string[];
}

const DAY_MS = 86_400_000;

/**
 * Business task ranking — pure, reads weights from ranking_weights (never
 * constants; plan correction #2). Personal-project tasks are excluded
 * entirely (principle 7).
 */
export function rankTasks(ds: Dataset, todayIso: string): RankedTask[] {
  const w = ds.ranking_weights;
  const total = w.objective_fit + w.unblocks + w.deadline || 1;
  const personal = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
  const today = new Date(todayIso + 'T00:00:00Z').getTime();

  const open = ds.tasks.filter((t) => t.status !== 'done' && !personal.has(t.project_id));

  return open
    .map((task) => {
      const why: string[] = [];

      // Objective fit: linked objective scaled by how far its KRs still have to go.
      let objectiveFit = 0;
      if (task.objective_id) {
        const krs = ds.key_results.filter((k) => k.objective_id === task.objective_id);
        const avg = krs.length ? krs.reduce((a, k) => a + k.progress_pct, 0) / krs.length : 0;
        objectiveFit = 60 + (100 - avg) * 0.4; // linked floor 60, urgency of the objective on top
        const obj = ds.objectives.find((o) => o.id === task.objective_id);
        if (obj) why.push(`Advances "${obj.title}" (${Math.round(avg)}% complete)`);
      } else {
        why.push('No linked objective — sinks in rank');
      }

      // Unblocks: tags that signal coupling, other-person tasks in review, priority.
      let unblocks = 0;
      if (task.tags.includes('blocked')) unblocks += 10;
      if (task.tags.includes('urgent-path')) unblocks += 45;
      if (task.tags.includes('needs-raghuvar')) unblocks += 25;
      if (task.status === 'in_review') {
        unblocks += 35;
        why.push('In review — closing it unblocks the other person');
      }
      if (task.priority === 'urgent') unblocks += 25;
      else if (task.priority === 'high') unblocks += 15;
      unblocks = Math.min(100, unblocks);

      // Deadline proximity: ≤0 days → 100, 14+ days → 0.
      let deadline = 0;
      if (task.due_date) {
        const due = new Date(task.due_date + 'T00:00:00Z').getTime();
        const days = Math.round((due - today) / DAY_MS);
        deadline = Math.max(0, Math.min(100, Math.round(100 - (days / 14) * 100)));
        if (days <= 0) why.push(`Due ${days === 0 ? 'today' : `${-days}d ago`}`);
        else if (days <= 3) why.push(`Due in ${days}d`);
      }

      const score =
        (objectiveFit * w.objective_fit + unblocks * w.unblocks + deadline * w.deadline) / total;

      return { task, objectiveFit: Math.round(objectiveFit), unblocks, deadline, score: Math.round(score * 10) / 10, why };
    })
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
}
