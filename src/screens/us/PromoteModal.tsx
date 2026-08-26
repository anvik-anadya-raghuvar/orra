import React, { useEffect, useState } from 'react';
import type { Message } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { ProjectCombo } from '../../ui/pickers';
import { makeTask } from '../../lib/taskFactory';

export type PromoteKind = 'task' | 'note' | 'decision';
export interface PromoteTarget {
  message: Message;
  kind: PromoteKind;
}

const KIND_LABEL: Record<PromoteKind, string> = {
  task: 'a task',
  note: 'a scribble',
  decision: 'a decision',
};

/** First 8 words of a message body — the modal's title prefill. */
function firstWords(text: string, n = 8): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ') || 'Untitled';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          display: 'block',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--mute)',
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export function PromoteModal({ promote, onClose }: { promote: PromoteTarget | null; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    if (!promote) return;
    setTitle(firstWords(promote.message.body));
    setDesc(promote.message.body);
    setProjectId('');
    // Only re-seed the form when a new message is targeted, not on every dataset tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promote]);

  const confirm = () => {
    if (!promote) return;
    /* All three promotion targets — task, note, decision — have a NOT NULL
       project_id, so one guard covers the lot. */
    if (!projectId) {
      toast('Choose or type a project to promote this into');
      return;
    }
    const { message, kind } = promote;
    if (kind === 'task') {
      const id = store.nextTaskId();
      store.insert(
        'tasks',
        makeTask({
          id,
          title: title.trim() || 'Untitled task',
          description: desc,
          project_id: projectId,
          created_by: store.meId,
        }),
        store.asMe({ summary: `Task ${id} created from a message` }),
      );
      store.update(
        'messages',
        message.id,
        { promoted_to_type: 'task', promoted_to_id: id },
        store.asMe({ summary: 'Message promoted to task' }),
      );
      toast(`Promoted to ${id}`);
    } else if (kind === 'note') {
      const id = newId('note');
      store.insert(
        'notes',
        {
          id,
          title: title.trim() || 'Untitled scribble',
          body: desc,
          type: 'plain',
          project_id: projectId,
          task_id: null,
          tags: [],
          is_pinned: false,
          transcript: null,
          checklist: null,
          source_ref: null,
          created_by: store.meId,
          owner_id: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: 'Note created from a message' }),
      );
      store.update(
        'messages',
        message.id,
        { promoted_to_type: 'note', promoted_to_id: id },
        store.asMe({ summary: 'Message promoted to scribble' }),
      );
      toast('Promoted to a scribble');
    } else {
      const id = newId('dec');
      store.insert(
        'decisions',
        {
          id,
          question: title.trim() || 'Untitled decision',
          project_id: projectId,
          recommendation: desc,
          owner_id: store.meId,
          status: 'open',
          opened_at: nowIso(),
          ruled_at: null,
          ruling_note: '',
        },
        store.asMe({ summary: 'Decision raised from a message' }),
      );
      store.update(
        'messages',
        message.id,
        { promoted_to_type: 'decision', promoted_to_id: id },
        store.asMe({ summary: 'Message promoted to decision' }),
      );
      toast('Promoted to a decision');
    }
    onClose();
  };

  return (
    <Modal
      open={!!promote}
      onClose={onClose}
      title={promote ? `Promote to ${KIND_LABEL[promote.kind]}` : undefined}
    >
      {promote && (
        <>
          <Field label={promote.kind === 'decision' ? 'Question' : 'Title'}>
            <input
              className="statusinput"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div style={{ height: 10 }} />
          <Field label={promote.kind === 'decision' ? 'Recommendation' : 'Description'}>
            <textarea
              className="statusinput"
              style={{ minHeight: 92, resize: 'vertical' }}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Project">
            <ProjectCombo className="statuslike" value={projectId} onChange={setProjectId} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 18 }}>
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn solid" type="button" onClick={confirm}>
              Create
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
