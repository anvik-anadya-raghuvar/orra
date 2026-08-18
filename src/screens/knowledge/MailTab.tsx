import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { useToast } from '../../ui/bits';
import { staggerList, staggerItem, staggerParent } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import { MiniBars } from '../../ui/viz';
import type { MailItem } from '../../types';
import { makeTask } from '../../lib/taskFactory';

export default function MailTab() {
  const mail = useData((ds) => ds.mail_items);

  const summary = useMemo(() => {
    const total = mail.length;
    const flagged = mail.filter((m) => m.flag_reason).length;
    const unconverted = mail.filter((m) => !m.converted_to_type).length;
    return { total, flagged, unconverted };
  }, [mail]);

  const groups = useMemo(() => {
    const byAccount = new Map<string, MailItem[]>();
    for (const m of mail) {
      const list = byAccount.get(m.account_email) ?? [];
      list.push(m);
      byAccount.set(m.account_email, list);
    }
    for (const list of byAccount.values()) {
      list.sort((a, b) => b.received_at.localeCompare(a.received_at));
    }
    return [...byAccount.entries()];
  }, [mail]);

  if (groups.length === 0) return <p className="tip">Nothing synced yet.</p>;

  return (
    <div>
      <div className="kn-ov-panel" style={{ marginBottom: 16 }}>
        <span className="eyebrow">Inbox at a glance</span>
        <MiniBars
          items={[
            { label: 'Flagged', value: summary.flagged, max: summary.total || 1, color: 'var(--rose)' },
            {
              label: 'Unconverted',
              value: summary.unconverted,
              max: summary.total || 1,
              color: 'var(--stamp)',
            },
          ]}
        />
      </div>
      {groups.map(([account, rows]) => (
        <div className="mail-group" key={account}>
          <h4>{account}</h4>
          <motion.div {...staggerParent()}>
            {rows.map((m) => (
              <MailRow key={m.id} mail={m} />
            ))}
          </motion.div>
        </div>
      ))}
      <p className="tip">
        Read-only sync across both mailboxes. Conversions keep the source message reference so a task, note, or
        decision traces back to its email.
      </p>
    </div>
  );
}

function MailRow({ mail }: { mail: MailItem }) {
  const store = useStore();
  const toast = useToast();

  const convertTask = () => {
    const id = store.nextTaskId();
    store.insert(
      'tasks',
      makeTask({
        id,
        title: mail.subject,
        description: mail.snippet,
        project_id: mail.project_id ?? 'anvik',
        created_by: store.meId,
      }),
      store.asMe({ summary: `Task created from mail — ${mail.subject}` }),
    );
    store.update('mail_items', mail.id, { converted_to_type: 'task', converted_to_id: id }, store.asMe());
    toast('Converted to task');
  };

  const convertNote = () => {
    const id = newId('n');
    store.insert(
      'notes',
      {
        id,
        title: mail.subject,
        body: mail.snippet,
        type: 'email',
        project_id: mail.project_id ?? 'anvik',
        task_id: null,
        tags: [],
        is_pinned: false,
        transcript: null,
        checklist: null,
        source_ref: 'gmail:' + mail.id,
        created_by: store.meId,
        created_at: nowIso(),
      },
      store.asMe({ summary: `Note created from mail — ${mail.subject}` }),
    );
    store.update('mail_items', mail.id, { converted_to_type: 'note', converted_to_id: id }, store.asMe());
    toast('Converted to note');
  };

  const convertDecision = () => {
    const id = newId('dec');
    store.insert(
      'decisions',
      {
        id,
        question: mail.subject,
        project_id: mail.project_id ?? 'anvik',
        recommendation: '',
        owner_id: store.meId,
        status: 'open',
        opened_at: nowIso(),
        ruled_at: null,
        ruling_note: '',
      },
      store.asMe({ summary: `Decision raised from mail — ${mail.subject}` }),
    );
    store.update('mail_items', mail.id, { converted_to_type: 'decision', converted_to_id: id }, store.asMe());
    toast('Converted to decision');
  };

  return (
    <motion.div variants={staggerItem} className="mail-row">
      <div className="m-main">
        <div className="m-sender">{mail.sender}</div>
        <div className="m-subject">{mail.subject}</div>
        <div className="m-snippet">{mail.snippet}</div>
        <div className="m-meta">
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--mute)' }}>
            {fmtDateTime(mail.received_at)}
          </span>
          {mail.flag_reason && <span className="pill over">{mail.flag_reason}</span>}
          <a className="lk" href={mail.gmail_link} target="_blank" rel="noreferrer">
            Open in Gmail
          </a>
        </div>
      </div>
      <div className="mail-actions">
        {mail.converted_to_type ? (
          <ConvertedChip mail={mail} />
        ) : (
          <>
            <button className="btn sm" onClick={convertTask}>
              → Task
            </button>
            <button className="btn sm" onClick={convertNote}>
              → Note
            </button>
            <button className="btn sm" onClick={convertDecision}>
              → Decision
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function ConvertedChip({ mail }: { mail: MailItem }) {
  const label =
    mail.converted_to_type === 'task'
      ? 'Task created'
      : mail.converted_to_type === 'note'
        ? 'Note created'
        : 'Decision raised';
  const chip = <span className="pill ok">✓ {label}</span>;
  if (mail.converted_to_type === 'task') {
    return (
      <Link
        to={`/task/${mail.converted_to_id}`}
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
      >
        {chip}
      </Link>
    );
  }
  return chip;
}
