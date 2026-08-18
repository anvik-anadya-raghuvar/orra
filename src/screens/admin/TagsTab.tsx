import { useState } from 'react';
import { motion } from 'framer-motion';
import { newId, useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { staggerItem, staggerList, staggerParent } from '../../ui/motion';
import type { Tag } from '../../types';
import { TAG_COLORS, tagUsageCounts } from './common';

export default function TagsTab() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState<(typeof TAG_COLORS)[number]>('indigo');

  const counts = tagUsageCounts(ds);

  const recolor = (tag: Tag, next: string) => {
    store.update('tags', tag.id, { color: next }, store.asMe());
    toast(`${tag.name} recoloured`);
  };

  const deleteEverywhere = (tag: Tag) => {
    const uses = counts[tag.name] ?? 0;
    const ok = window.confirm(
      `Delete tag "${tag.name}" everywhere? It will be removed from ${uses} item${uses === 1 ? '' : 's'} and cannot be undone.`,
    );
    if (!ok) return;
    for (const t of ds.tasks) {
      if (t.tags.includes(tag.name)) {
        store.update('tasks', t.id, { tags: t.tags.filter((x) => x !== tag.name) }, store.asMe());
      }
    }
    for (const n of ds.notes) {
      if (n.tags.includes(tag.name)) {
        store.update('notes', n.id, { tags: n.tags.filter((x) => x !== tag.name) }, store.asMe());
      }
    }
    store.remove('tags', tag.id, store.asMe({ summary: `Tag removed everywhere — ${tag.name}` }));
    toast(`"${tag.name}" removed everywhere`);
  };

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    if (ds.tags.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
      toast(`"${clean}" already exists`);
      return;
    }
    store.insert(
      'tags',
      { id: newId('tag'), name: clean, color, created_by: store.me.id, created_at: new Date().toISOString() },
      store.asMe({ summary: `Tag created — ${clean}` }),
    );
    toast(`"${clean}" created`);
    setName('');
  };

  return (
    <div>
      <div className="ad-tag-create filters">
        <input
          className="srch"
          type="text"
          placeholder="New tag name — e.g. waiting-on-bank"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <select
          className="srch"
          style={{ flex: '0 0 130px' }}
          value={color}
          onChange={(e) => setColor(e.target.value as (typeof TAG_COLORS)[number])}
        >
          {TAG_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="btn sm solid" type="button" onClick={create}>
          Create
        </button>
      </div>

      <motion.div {...staggerParent()}>
        {ds.tags.map((t) => (
          <motion.div key={t.id} className="ad-tag-row" variants={staggerItem}>
            <span className="ad-dot" style={{ background: `var(--${t.color})` }} />
            <span className="ad-tag-name">{t.name}</span>
            <span className="mono ad-tag-count">
              {counts[t.name] ?? 0} use{(counts[t.name] ?? 0) === 1 ? '' : 's'}
            </span>
            <select className="srch ad-tag-select" value={t.color} onChange={(e) => recolor(t, e.target.value)}>
              {TAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button className="pill q" type="button" onClick={() => deleteEverywhere(t)}>
              remove
            </button>
          </motion.div>
        ))}
      </motion.div>
      {ds.tags.length === 0 && <p className="tip">No tags yet.</p>}
      <p className="tip">
        Tags cut across projects and screens. Removing one here strips it everywhere and writes one trail
        row per item touched.
      </p>
    </div>
  );
}
