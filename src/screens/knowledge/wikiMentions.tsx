import React from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../../data/store';

/** A run of page text: either plain prose or a resolved task mention. */
export type MentionPart = { kind: 'text'; text: string } | { kind: 'task'; id: string };

const TASK_RE = /\bT-\d+\b/g;

/**
 * Pure. Splits text into plain runs and task mentions.
 *
 * `exists` decides which ids are real, so an id that looks like a task but
 * isn't one in the dataset stays plain text rather than becoming a dead link.
 */
export function parseMentions(text: string, exists: (id: string) => boolean): MentionPart[] {
  const parts: MentionPart[] = [];
  if (!text) return parts;
  let last = 0;
  for (const m of text.matchAll(TASK_RE)) {
    const id = m[0];
    const start = m.index ?? 0;
    if (!exists(id)) continue;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'task', id });
    last = start + id.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Renders page prose with live task mentions. React nodes only — no innerHTML. */
export function RichText({ text }: { text: string }) {
  const taskIds = useData((ds) => ds.tasks.map((t) => t.id));
  const parts = parseMentions(text ?? '', (id) => taskIds.includes(id));
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'task' ? (
          <Link key={i} className="wk-mention" to={`/task/${p.id}`} onClick={(e) => e.stopPropagation()}>
            {p.id}
          </Link>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}
