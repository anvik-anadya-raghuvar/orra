/**
 * The optional links on a person: LinkedIn, Instagram, a company site, a
 * WhatsApp number somebody printed as a wa.me URL.
 *
 * Optional in the real sense — a person with no links shows one empty row and
 * takes up four lines of the sheet, not a section header and a placeholder
 * explaining what links are.
 *
 * The label is guessed from the URL and then left alone. Guessing means you
 * paste a LinkedIn address and the row says LinkedIn without being asked;
 * leaving it alone afterwards means the guess is never fighting you, because
 * the label is an editable text field like any other and 'Nilesh — personal'
 * is a perfectly good name for a link. No dropdown of platforms, no list to
 * keep current, nothing rejected for being unrecognised.
 */

import { motion } from 'framer-motion';
import {
  Facebook,
  Github,
  Globe,
  Instagram,
  Linkedin,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  Twitter,
  Youtube,
} from 'lucide-react';
import { newId } from '../../data/store';
import { useToast } from '../../ui/bits';
import { micro, staggerItem, staggerParent } from '../../ui/motion';
import { guessLinkLabel, linkIcon, normalizeUrl, type LinkIcon } from '../../lib/socialLinks';
import { MAX_PERSON_SOCIAL_LINKS, type SocialLink } from '../../types';
import { inputStyle } from './style';

const ICONS: Record<LinkIcon, typeof Globe> = {
  linkedin: Linkedin,
  twitter: Twitter,
  instagram: Instagram,
  facebook: Facebook,
  github: Github,
  youtube: Youtube,
  whatsapp: MessageCircle,
  telegram: Send,
  globe: Globe,
};

export default function SocialLinks({
  links,
  onChange,
}: {
  links: SocialLink[];
  onChange: (links: SocialLink[]) => void;
}) {
  const toast = useToast();

  const add = () => {
    if (links.length >= MAX_PERSON_SOCIAL_LINKS) {
      toast(`A person keeps at most ${MAX_PERSON_SOCIAL_LINKS} links`);
      return;
    }
    onChange([...links, { id: newId('sl'), label: '', url: '' }]);
  };

  const patch = (id: string, next: Partial<SocialLink>) =>
    onChange(links.map((l) => (l.id === id ? { ...l, ...next } : l)));

  return (
    <section className="sociallinks">
      <div className="sl-head">
        <span className="eyebrow">Links</span>
        <span className="tip sl-tip">Optional — LinkedIn, Instagram, a website.</span>
      </div>

      <motion.ul className="sl-list" {...staggerParent()}>
        {links.map((l) => {
          const Icon = ICONS[linkIcon(l.url)];
          return (
            <motion.li className="sl-row" key={l.id} variants={staggerItem}>
              <span className="sl-icon" aria-hidden>
                <Icon size={15} strokeWidth={1.8} />
              </span>
              <input
                type="text"
                className="sl-label"
                value={l.label}
                aria-label="Link label"
                placeholder="Label"
                onChange={(e) => patch(l.id, { label: e.target.value })}
                style={{ ...inputStyle, marginBottom: 0 }}
              />
              <input
                type="url"
                inputMode="url"
                className="sl-url"
                value={l.url}
                aria-label="Link address"
                placeholder="linkedin.com/in/…"
                onChange={(e) => patch(l.id, { url: e.target.value })}
                // The label is filled in on blur, not on every keystroke: doing
                // it as you type would rewrite the label while the URL is still
                // half-typed and briefly wrong. And only when the label is
                // still empty — a guess never overwrites a label somebody set.
                onBlur={(e) => {
                  const url = normalizeUrl(e.target.value);
                  patch(l.id, { url, label: l.label.trim() || (url ? guessLinkLabel(url) : '') });
                }}
                style={{ ...inputStyle, marginBottom: 0 }}
              />
              <motion.button
                type="button"
                className="sl-remove"
                aria-label={`Remove the ${l.label || 'untitled'} link`}
                onClick={() => onChange(links.filter((x) => x.id !== l.id))}
                whileTap={{ scale: 0.94, transition: micro }}
              >
                <Trash2 size={15} aria-hidden />
              </motion.button>
            </motion.li>
          );
        })}
      </motion.ul>

      <button type="button" className="btn sm sl-add" onClick={add}>
        <Plus size={13} aria-hidden /> {links.length ? 'Another link' : 'Add a link'}
      </button>
    </section>
  );
}
