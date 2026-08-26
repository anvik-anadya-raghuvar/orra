/**
 * Rich inline text: the small markdown-like syntax that every free-text
 * surface renders — wiki blocks, notes, task descriptions. One parser and
 * one set of components, so a color or a mention behaves identically no
 * matter where it was typed.
 *
 * `parseRichText` is a pure, linear scan (first token wins, no nesting) —
 * deliberately simple over deliberately complete, matching everywhere else
 * in this app that a lightweight custom format beats pulling in a markdown
 * library for two people's notes.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { matchChecklistLine } from '../lib/checklist';
import { useData } from '../data/store';
import './richText.css';

export type RichPart =
  | { kind: 'text'; text: string }
  | { kind: 'task'; id: string }
  | { kind: 'page'; id: string; label: string }
  | { kind: 'person'; id: string; label: string }
  | { kind: 'date'; value: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'mark'; mark: 'bold' | 'italic' | 'underline' | 'strike' | 'code'; text: string }
  | { kind: 'color'; color: string; text: string }
  | { kind: 'size'; size: string; text: string };

interface TokenSpec {
  regex: RegExp;
  read: (match: RegExpExecArray) => RichPart;
}

const TOKENS: TokenSpec[] = [
  { regex: /\[\[page:([^|\]]+)\|([^\]]+)\]\]/, read: (m) => ({ kind: 'page', id: m[1], label: m[2] }) },
  { regex: /\[\[person:([^|\]]+)\|([^\]]+)\]\]/, read: (m) => ({ kind: 'person', id: m[1], label: m[2] }) },
  { regex: /\[\[date:([^\]]+)\]\]/, read: (m) => ({ kind: 'date', value: m[1] }) },
  { regex: /\{\{color:([a-z]+)\|([^{}]+)\}\}/, read: (m) => ({ kind: 'color', color: m[1], text: m[2] }) },
  { regex: /\{\{size:([a-z]+)\|([^{}]+)\}\}/, read: (m) => ({ kind: 'size', size: m[1], text: m[2] }) },
  { regex: /\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/, read: (m) => ({ kind: 'link', label: m[1], url: m[2] }) },
  { regex: /\*\*([^*]+)\*\*/, read: (m) => ({ kind: 'mark', mark: 'bold', text: m[1] }) },
  { regex: /__([^_]+)__/, read: (m) => ({ kind: 'mark', mark: 'underline', text: m[1] }) },
  { regex: /~~([^~]+)~~/, read: (m) => ({ kind: 'mark', mark: 'strike', text: m[1] }) },
  { regex: /`([^`]+)`/, read: (m) => ({ kind: 'mark', mark: 'code', text: m[1] }) },
  { regex: /_([^_]+)_/, read: (m) => ({ kind: 'mark', mark: 'italic', text: m[1] }) },
  { regex: /\bT-\d+\b/, read: (m) => ({ kind: 'task', id: m[0] }) },
];

/** Pure rich-inline parser. It deliberately emits React-safe data, never HTML. */
export function parseRichText(text: string, taskExists: (id: string) => boolean): RichPart[] {
  const out: RichPart[] = [];
  let rest = text;
  while (rest) {
    let winner: { spec: TokenSpec; match: RegExpExecArray } | null = null;
    for (const spec of TOKENS) {
      const match = spec.regex.exec(rest);
      if (!match) continue;
      if (!winner || (match.index ?? 0) < (winner.match.index ?? 0)) winner = { spec, match };
    }
    if (!winner) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    const index = winner.match.index ?? 0;
    if (index > 0) out.push({ kind: 'text', text: rest.slice(0, index) });
    const part = winner.spec.read(winner.match);
    if (part.kind === 'task' && !taskExists(part.id)) out.push({ kind: 'text', text: winner.match[0] });
    else out.push(part);
    rest = rest.slice(index + winner.match[0].length);
  }
  return out;
}

/** Rich inline text: formatting, safe links, task/page/person/date mentions. */
export function RichText({ text, onSelectPage }: { text: string; onSelectPage?: (id: string) => void }) {
  const tasks = useData((ds) => ds.tasks);
  const pages = useData((ds) => ds.pages);
  const profiles = useData((ds) => ds.profiles);
  const ids = new Set(tasks.map((task) => task.id));
  const parts = parseRichText(text ?? '', (id) => ids.has(id));
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'task') {
          return (
            <Link key={index} className="wk-mention" to={`/task/${part.id}`} onClick={(event) => event.stopPropagation()}>
              {part.id}
            </Link>
          );
        }
        if (part.kind === 'page') {
          const exists = pages.some((page) => page.id === part.id);
          return exists && onSelectPage ? (
            <button key={index} type="button" className="wk-inline-mention" onClick={(event) => { event.stopPropagation(); onSelectPage?.(part.id); }}>
              ↗ {part.label}
            </button>
          ) : <span key={index} className="wk-inline-mention">↗ {part.label}</span>;
        }
        if (part.kind === 'person') {
          const profile = profiles.find((candidate) => candidate.id === part.id);
          return <span key={index} className="wk-inline-mention">@{profile?.name ?? part.label}</span>;
        }
        if (part.kind === 'date') return <time key={index} className="wk-inline-mention" dateTime={part.value}>@{part.value}</time>;
        if (part.kind === 'link') return <a key={index} className="wk-link" href={part.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{part.label}</a>;
        if (part.kind === 'color') return <span key={index} className={`rt-color-${part.color}`}>{part.text}</span>;
        if (part.kind === 'size') return <span key={index} className={`rt-size-${part.size}`}>{part.text}</span>;
        if (part.kind === 'mark') {
          if (part.mark === 'bold') return <strong key={index}>{part.text}</strong>;
          if (part.mark === 'italic') return <em key={index}>{part.text}</em>;
          if (part.mark === 'underline') return <u key={index}>{part.text}</u>;
          if (part.mark === 'strike') return <s key={index}>{part.text}</s>;
          return <code key={index} className="wk-inline-code">{part.text}</code>;
        }
        return <React.Fragment key={index}>{part.text}</React.Fragment>;
      })}
    </>
  );
}

type TextBlock =
  | { kind: 'check'; rows: { line: number; label: string; done: boolean }[] }
  | { kind: 'bullet' | 'plain'; rows: { line: number; content: string }[] };

/**
 * A block of free-typed text — notes, task descriptions — rendered with the
 * same inline formatting as the wiki, plus the two things a flat textarea
 * needs that a wiki block gets for free from its block type: lines starting
 * with `- ` render as an actual bulleted list instead of a line of dashes,
 * and `- [ ] ` lines render as real tick boxes instead of a bullet that
 * reads "[ ] step".
 *
 * Pass `onToggleCheck` to make those boxes clickable; it is handed the line
 * index, which is what `toggleChecklistLine` wants back. Without it they
 * render as disabled boxes — a note's checklist is a record, a task brief's
 * is a control, and the same text has to serve both.
 */
export function FormattedText({
  text,
  className,
  onSelectPage,
  onToggleCheck,
}: {
  text: string;
  className?: string;
  onSelectPage?: (id: string) => void;
  onToggleCheck?: (line: number) => void;
}) {
  const blocks: TextBlock[] = [];
  (text ?? '').split('\n').forEach((raw, line) => {
    const box = matchChecklistLine(raw);
    const kind: TextBlock['kind'] = box ? 'check' : raw.startsWith('- ') || raw.startsWith('• ') ? 'bullet' : 'plain';
    const last = blocks[blocks.length - 1];
    const row = box ? { line, ...box } : { line, content: kind === 'bullet' ? raw.slice(2) : raw };
    if (last && last.kind === kind) (last.rows as typeof row[]).push(row);
    else blocks.push({ kind, rows: [row] } as TextBlock);
  });
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'check') {
          return (
            <ul className="rt-checks" key={index}>
              {block.rows.map((row) => (
                <li key={row.line}>
                  <button
                    type="button"
                    className="rt-check"
                    aria-pressed={row.done}
                    disabled={!onToggleCheck}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleCheck?.(row.line);
                    }}
                  >
                    <span className={`rt-box${row.done ? ' on' : ''}`} aria-hidden />
                    <span className={row.done ? 'rt-struck' : undefined}>
                      <RichText text={row.label} onSelectPage={onSelectPage} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <ul className="rt-bullets" key={index}>
              {block.rows.map((row) => (
                <li key={row.line}><RichText text={row.content} onSelectPage={onSelectPage} /></li>
              ))}
            </ul>
          );
        }
        return (
          <p className={className} key={index}>
            {block.rows.map((row, rowIndex) => (
              <React.Fragment key={row.line}>
                {rowIndex > 0 && <br />}
                <RichText text={row.content} onSelectPage={onSelectPage} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
