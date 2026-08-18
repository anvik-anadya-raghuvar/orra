import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { staggerItem, staggerList } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import type { AutomationRule } from '../../types';

export default function RulesTab() {
  const rules = useData((ds) => ds.automation_rules);
  const store = useStore();
  const toast = useToast();

  const flip = (r: AutomationRule) => {
    store.update('automation_rules', r.id, { is_active: !r.is_active }, store.asMe());
    toast(`${r.trigger_label} → ${r.action_label} is now ${!r.is_active ? 'on' : 'off'}`);
  };

  return (
    <div>
      <motion.div variants={staggerList} initial="initial" animate="animate">
        {rules.map((r) => (
          <motion.div key={r.id} className="ad-rule" variants={staggerItem}>
            <div className="ad-rule-text">
              <span className="ad-w">when</span> {r.trigger_label}
              <span className="ad-w"> → then </span> {r.action_label}
              <span className="mono ad-fired">
                {r.last_fired_at ? `last fired ${fmtDateTime(r.last_fired_at)}` : 'never fired'}
              </span>
            </div>
            <button
              type="button"
              className={`ad-sw${r.is_active ? '' : ' off'}`}
              role="switch"
              aria-checked={r.is_active}
              aria-label={`${r.trigger_label} → ${r.action_label}`}
              onClick={() => flip(r)}
            >
              <motion.span className="ad-knob" layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
            </button>
          </motion.div>
        ))}
      </motion.div>
      {rules.length === 0 && <p className="tip">No automation rules configured.</p>}
      <p className="tip">
        Plain sentences, no scripting. Every rule that fires writes its own trail row — automation never
        happens invisibly.
      </p>
    </div>
  );
}
