/**
 * Making and choosing projects, in one place.
 *
 * Projects are seeded database rows, never enum constants (principle 9), and
 * they are shared between both people rather than owned by one — what Anadya
 * creates, Raghuvar has. Several screens need to create one mid-flow, and
 * several more need "which project should this default to", so both live here
 * instead of being re-derived per screen with slightly different answers.
 */
import type { AppStore } from './store';
import { newId, nowIso } from './store';
import type { Project } from '../types';

/**
 * Palette for auto-created projects, rotating so consecutive ones look
 * distinct on the board. Kept beside the creator rather than imported from
 * the Work screen — a data helper should not depend on a room's vocabulary.
 */
const PROJECT_COLORS = ['indigo', 'teal', 'stamp', 'rose', 'sky', 'violet', 'slate'];

/**
 * Create a project and return its id.
 *
 * `is_personal: false` on purpose: a project typed into a task, a ledger
 * entry or a note is shared work by definition. The Personal room's own
 * projects are made there, where that flag means something.
 *
 * Callers are expected to have already ruled out a same-name duplicate —
 * `resolveCommit` in ui/pickerLogic.ts does that, case-insensitively, and is
 * the only path the pickers use.
 */
export function createProject(store: AppStore, projects: Project[], name: string): string {
  const clean = name.trim();
  const id = newId('proj');
  store.insert(
    'projects',
    {
      id,
      name: clean,
      color: `var(--${PROJECT_COLORS[projects.length % PROJECT_COLORS.length]})`,
      description: '',
      is_personal: false,
      created_at: nowIso(),
    },
    store.asMe({ summary: `Project created — ${clean}` }),
  );
  return id;
}

/**
 * The project a new row should land in when nobody picked one.
 *
 * Business before personal, because the screens that ask this — quick
 * capture, mail conversion, a CSV import — are recording work. Null when
 * there are no projects at all, which callers must handle rather than
 * writing an empty string into a NOT NULL foreign key.
 */
export function defaultProjectId(projects: Project[]): string | null {
  return projects.find((p) => !p.is_personal)?.id ?? projects[0]?.id ?? null;
}

/**
 * The project an automatic write should use, creating a fallback if the
 * workspace has none yet.
 *
 * This exists because "there are no projects" used to mean "silently drop
 * what the user just typed" (Home's quick capture) or "reference a project id
 * that no longer exists" (mail conversion). Neither is acceptable: the point
 * of quick capture is that a thought is never lost.
 */
export function ensureProjectId(store: AppStore, projects: Project[]): string {
  return defaultProjectId(projects) ?? createProject(store, projects, 'General');
}

/** True when `id` still points at a project that exists. */
export function projectExists(projects: Project[], id: string | null | undefined): boolean {
  return !!id && projects.some((p) => p.id === id);
}

/**
 * The ids of every project marked personal.
 *
 * The Personal room's widgets used to ask for `project_id === 'personal'` — a
 * literal seed id, which stopped matching anything the moment projects became
 * something you make yourself. What they actually mean is "a project on the
 * personal side of the wall", which is the flag, not a name.
 */
export function personalProjectIds(projects: Project[]): Set<string> {
  return new Set(projects.filter((p) => p.is_personal).map((p) => p.id));
}
