/**
 * Turning the text an OCR engine read off a business card into fields.
 *
 * Deliberately a pure function over a string. The engine is slow, needs a
 * worker, a wasm core and 7 MB of model, and cannot run in a unit test; the
 * guessing is where every real mistake lives. Splitting them means the part
 * that gets things wrong is the part that is cheap to test — cardScan.test.ts
 * runs real card layouts through this in milliseconds.
 *
 * None of this is clever, and it is not supposed to be. Every field it fills
 * is a *suggestion* shown for review before it touches the profile; a wrong
 * guess costs one correction, and a missing guess costs one typed field. That
 * budget is what licenses heuristics this blunt.
 *
 * The signals, strongest first:
 *
 *  - **The email address**, which is the most machine-readable thing on a card
 *    and the anchor for two other fields. `anadya.raghuvar@anvik.club` names
 *    the person *and* the company, and matching its local part against the
 *    candidate lines beats guessing which line is a name from shape alone.
 *  - **Text size.** Tesseract reports a bounding box per line, and on almost
 *    every card in existence the person's name is the biggest thing on it.
 *    Passed in when available; the parser still works without it, which is why
 *    the tests can be plain strings.
 *  - **Vocabulary.** 'Pvt Ltd' and 'S.r.l.' say company; 'Co-Founder' and
 *    'Head of Design' say role. Short lists, easily extended, never exhaustive.
 */

import { guessLinkLabel, normalizeUrl } from './socialLinks';

/** One line as the engine saw it. `height` is the line's bounding box in
 *  pixels — relative sizes are what matter, never the absolute number. */
export interface ScannedLine {
  text: string;
  height?: number;
}

/** A link found on the card, before it becomes a `SocialLink` row. */
export interface ScannedLink {
  label: string;
  url: string;
}

export interface CardFields {
  name: string;
  role: string;
  company: string;
  /** Best first. A card carrying a personal and a general address gives two. */
  emails: string[];
  /** Best first — a mobile ahead of a landline, since that is the one you
   *  would actually dial. */
  phones: string[];
  links: ScannedLink[];
}

const EMPTY: CardFields = { name: '', role: '', company: '', emails: [], phones: [], links: [] };

/* ── vocabulary ────────────────────────────────────────────────────────── */

/** Words that make a line a job title rather than a name or a company. */
const ROLE_WORDS = [
  'founder', 'co-founder', 'cofounder', 'ceo', 'cto', 'coo', 'cfo', 'cmo',
  'director', 'manager', 'head', 'chief', 'president', 'vp', 'vice president',
  'engineer', 'developer', 'designer', 'architect', 'consultant', 'analyst',
  'partner', 'principal', 'lead', 'officer', 'executive', 'associate',
  'specialist', 'coordinator', 'supervisor', 'proprietor', 'owner',
  'professor', 'lecturer', 'researcher', 'scientist', 'advocate', 'attorney',
  'accountant', 'sales', 'marketing', 'operations', 'business development',
  'account', 'product', 'project',
];

/** Suffixes and words that make a line a company name. */
const COMPANY_WORDS = [
  'pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'incorporated',
  'corp', 'corporation', 'company', 'gmbh', 'srl', 'spa', 'bv', 'nv', 'ag',
  'plc', 'group', 'holdings', 'ventures', 'industries', 'enterprises',
  'technologies', 'technology', 'systems', 'solutions', 'services', 'labs',
  'laboratories', 'studio', 'studios', 'associates', 'consultancy',
  'consulting', 'international', 'global', 'trading', 'exports', 'imports',
  'manufacturing', 'university', 'institute', 'politecnico', 'college',
  'foundation', 'bank', 'textiles', 'steel',
];

/** Lines that are a label, not a value — dropped before anything is guessed. */
const LABEL_ONLY =
  /^(tel|telephone|phone|mob|mobile|cell|fax|email|e-mail|mail|web|website|address|addr|off|office|gst|gstin|pan|cin|vat|p\.?\s?iva)\s*[:.\-]?$/i;

/** Address-ish lines: full of digits and commas, and otherwise easily mistaken
 *  for a company. Not stored as a field — a card's postal address is rarely
 *  the thing you want six months later, and it stays in the scanned text. */
const ADDRESS_HINT =
  /\b(road|rd\.?|street|st\.?|lane|ln\.?|avenue|ave\.?|marg|nagar|sector|block|floor|building|bldg|plot|suite|apt|po box|p\.o\.|pin|pincode|zip|via|viale|piazza|corso)\b/i;

/* ── small helpers ─────────────────────────────────────────────────────── */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word containment, case-insensitive. 'Head of Design' matches 'head';
 *  'Headlands' does not. */
function hasWord(line: string, words: string[]): boolean {
  const l = line.toLowerCase();
  return words.some((w) => new RegExp(`(^|[^a-z])${escapeRe(w)}([^a-z]|$)`, 'i').test(l));
}

/** Everything that is not a letter, removed, so 'A.Raghuvar' and 'a raghuvar'
 *  compare equal — which is the whole point of comparing them. */
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Digits an engine misread as letters, put back.
 *
 * Only ever applied to a span PHONE_RE has already matched, and that match is
 * what makes it safe: the pattern admits nothing but digits, separators and
 * these three letters, so a span reaching here is a number with damage in it,
 * not prose. '+39 O2 2399 l234' is a Milan landline whichever way you read it.
 *
 * O/l/I only. S→5 and B→8 are real misreads too, but they fire on so much
 * ordinary text that they would cost more than they fix.
 */
function unmangleDigits(span: string): string {
  return span.replace(/[OolIi]/g, (c) => (c.toUpperCase() === 'O' ? '0' : '1'));
}

/* ── the readable bits ─────────────────────────────────────────────────── */

/**
 * `name@host.tld`, tolerating what OCR does to an '@' — a space either side,
 * or the '(at)' some cards print on purpose to dodge scrapers.
 */
const EMAIL_RE =
  /([A-Za-z0-9._%+-]+)\s*(?:@|\(at\)|\[at\])\s*([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

/** A URL, with or without a scheme, with or without the www. */
const URL_RE =
  /((?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?:\/[^\s,;]*)?)/g;

/**
 * Anything with enough digits in a row to be a phone number, in the shapes
 * cards print them: +91 98765 43210, (02) 1234 5678, 011-2345-6789.
 */
const PHONE_RE = /(\+?\d[\d\s().\-/OolIi]{5,}\d)/g;

/** A fresh regex each call. These are all /g, and a /g regex carries
 *  `lastIndex` between calls — sharing one instance across `matchAll` and a
 *  `test` in a filter makes it skip every other line, which is exactly the
 *  kind of bug that looks like a bad heuristic rather than a stateful regex. */
const re = (r: RegExp) => new RegExp(r.source, r.flags);

function readEmails(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re(EMAIL_RE))) {
    const addr = `${m[1]}@${m[2]}`.toLowerCase().replace(/[.,;:]+$/, '');
    if (!out.includes(addr)) out.push(addr);
  }
  // A personal address beats a shared one — 'anadya@' is worth more than
  // 'info@' or 'sales@', which is what a company card gives you.
  const generic = /^(info|contact|sales|hello|admin|office|enquiry|enquiries|support|mail|team)@/;
  return out.sort((a, b) => Number(generic.test(a)) - Number(generic.test(b)));
}

function readPhones(lines: string[]): string[] {
  const out: { value: string; mobile: boolean }[] = [];
  for (const raw of lines) {
    // A line's own label says which kind of number it is, and 'M:' or 'Mob'
    // is the one a person actually wants dialled.
    const mobile = /\b(m|mob|mobile|cell|cellulare|whatsapp)\b\s*[:.\-]?/i.test(raw);
    for (const m of raw.matchAll(re(PHONE_RE))) {
      const span = unmangleDigits(m[1]);
      const digits = span.replace(/\D/g, '');
      // Seven is the shortest real subscriber number; fifteen is E.164's
      // maximum, and a run past it is a GST number or an account code.
      if (digits.length < 7 || digits.length > 15) continue;
      if (out.some((p) => p.value.replace(/\D/g, '') === digits)) continue;
      const value = span.trim().replace(/\s{2,}/g, ' ').replace(/[.\-/]+$/, '');
      out.push({ value, mobile });
    }
  }
  return out.sort((a, b) => Number(b.mobile) - Number(a.mobile)).map((p) => p.value);
}

function readLinks(text: string, emails: string[]): ScannedLink[] {
  const out: ScannedLink[] = [];
  const seen = new Set<string>();

  // Emails come out of the text before a single URL is looked for. An address
  // is two false positives wearing a trench coat — 'r.mehta@example.com' reads
  // as the site 'r.mehta' and the site 'example.com' — and no amount of
  // comparing candidates afterwards fixes the first one, because 'r.mehta' is
  // domain-shaped and appears nowhere in the address list. Removing the whole
  // address first is the only version of this that is actually correct, and it
  // leaves a company that prints its website separately with its website.
  let hunting = text;
  for (const e of emails) hunting = hunting.split(e).join(' ');
  hunting = hunting.replace(re(EMAIL_RE), ' ');

  for (const m of hunting.matchAll(re(URL_RE))) {
    const raw = m[1].replace(/[.,;:]+$/, '');
    const url = normalizeUrl(raw);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Which platform a host belongs to is socialLinks.ts's question, not this
    // module's — a link typed by hand into the profile sheet has to be
    // labelled by the same rules a link read off a card is.
    out.push({ label: guessLinkLabel(url), url });
  }
  // Platforms first: a LinkedIn profile is the link you will actually open.
  return out.sort((a, b) => Number(a.label === 'Website') - Number(b.label === 'Website'));
}

/* ── the guessed bits ──────────────────────────────────────────────────── */

/** Could this line be a human name? Cheap structural test, no vocabulary. */
function nameShaped(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 60) return false;
  if (/[@\d]/.test(t)) return false; // an address or a number is not a name
  if (/\.[A-Za-z]{2,}(\/|$)/.test(t)) return false; // nor is a bare domain
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  if (hasWord(t, COMPANY_WORDS)) return false;
  if (hasWord(t, ROLE_WORDS)) return false;
  if (ADDRESS_HINT.test(t)) return false;
  // Mostly letters, allowing the punctuation real names carry, after any
  // honorific the card printed in front.
  return /^[A-Za-z][A-Za-z.'’\-\s]*$/.test(t.replace(/^(mr|mrs|ms|dr|prof|er|ca|adv)\.?\s+/i, ''));
}

/**
 * Which line is the person. The email's local part decides it when it can —
 * 'r.mehta@' picks 'R. Mehta' out of five candidates with no ambiguity — and
 * the biggest line on the card decides it when there is no email to go on.
 */
function pickName(candidates: ScannedLine[], emails: string[]): string {
  if (!candidates.length) return '';

  for (const email of emails) {
    const local = email.split('@')[0];
    const localFlat = letters(local);
    if (localFlat.length < 3) continue;
    // Both halves, both directions. A local part is written every way a person
    // can shorten a name — 'anadya.raghuvar', 'araghuvar', 'a.raghuvar',
    // 'nilesh' — so comparing the two as whole strings only ever catches the
    // easy third of them. Comparing word against word catches the rest:
    // 'c.rossi' meets 'Chiara Rossi' at 'rossi', which is contained in the
    // local part rather than containing it.
    const localWords = local.split(/[^A-Za-z]+/).map(letters).filter((w) => w.length >= 3);
    const score = (c: ScannedLine): number => {
      const flat = letters(c.text);
      if (flat.length < 3) return 0;
      let n = 0;
      if (flat.includes(localFlat) || localFlat.includes(flat)) n += 2;
      for (const w of localWords) if (flat.includes(w)) n += 1;
      for (const w of c.text.split(/\s+/).map(letters)) {
        if (w.length >= 3 && localFlat.includes(w)) n += 1;
      }
      return n;
    };
    const best = candidates
      .map((c) => ({ c, n: score(c) }))
      .reduce((a, b) => (b.n > a.n ? b : a));
    if (best.n > 0) return best.c.text.trim();
  }

  // No email, or nothing matched it: the largest text wins, and failing that
  // the first, since a card is read top-down and the name leads.
  const sized = candidates.filter((c) => typeof c.height === 'number');
  if (sized.length) {
    return sized.reduce((a, b) => ((b.height ?? 0) > (a.height ?? 0) ? b : a)).text.trim();
  }
  return candidates[0].text.trim();
}

/** A company name inferred from an email domain: 'anvik.club' → 'Anvik'. Only
 *  ever a fallback — a real line on the card beats it every time, because
 *  'Anvik' is not 'Anvik Technologies Pvt Ltd'. */
function companyFromEmail(email: string): string {
  const host = email.split('@')[1] ?? '';
  const base = host.replace(/^(www|mail|email)\./, '').split('.')[0] ?? '';
  if (base.length < 2) return '';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/* ── the whole thing ───────────────────────────────────────────────────── */

/**
 * Read a card. `text` is the engine's output; `lines` carries the per-line
 * bounding boxes when the caller has them, and can be omitted entirely — the
 * parser then degrades to shape and vocabulary, which is what the tests
 * exercise.
 */
export function parseCardText(text: string, lines?: ScannedLine[]): CardFields {
  if (!text || !text.trim()) return { ...EMPTY };

  const source: ScannedLine[] = lines?.length
    ? lines
    : text.split(/\r?\n/).map((t) => ({ text: t }));

  const clean = source
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0)
    // A line of pure punctuation is a rule or a logo the engine tried to read.
    .filter((l) => /[A-Za-z0-9]/.test(l.text))
    .filter((l) => !LABEL_ONLY.test(l.text));

  const flat = clean.map((l) => l.text);
  const joined = flat.join('\n');

  const emails = readEmails(joined);
  const phones = readPhones(flat);
  const links = readLinks(joined, emails);

  // A line carrying a contact detail is spent — it cannot also be the person's
  // name or the company's.
  const spent = new Set(
    clean
      .filter((l) => re(EMAIL_RE).test(l.text) || re(PHONE_RE).test(l.text) || re(URL_RE).test(l.text))
      .map((l) => l.text),
  );
  const free = clean.filter((l) => !spent.has(l.text));

  const roleLine = free.find((l) => hasWord(l.text, ROLE_WORDS));
  const companyLine =
    free.find((l) => hasWord(l.text, COMPANY_WORDS)) ??
    // Nothing said 'Ltd': fall back to a line that is not the role, not
    // name-shaped and not an address — which is usually the company.
    free.find((l) => l !== roleLine && !nameShaped(l.text) && !ADDRESS_HINT.test(l.text));

  const nameCandidates = free.filter(
    (l) => l !== roleLine && l !== companyLine && nameShaped(l.text),
  );

  return {
    name: pickName(nameCandidates, emails),
    role: roleLine?.text ?? '',
    company: companyLine?.text ?? (emails[0] ? companyFromEmail(emails[0]) : ''),
    emails,
    phones,
    links,
  };
}

/**
 * Merge the two sides of one card. The back is usually the same information in
 * another language, or the half that did not fit on the front — so the front
 * wins every single-value field, and the lists are concatenated without
 * duplicates.
 */
/**
 * The more specific of two company names, where one is the other with more of
 * it. The front usually wins outright, but not here: a card whose front says
 * 'Anvik' and whose back says 'Anvik Technologies Pvt Ltd' is one company
 * named twice, and the longer name is the one worth keeping. The same rule
 * quietly fixes the commonest version of this — a front with no company line
 * at all, where `parseCardText` fell back to inferring 'Surattextiles' from
 * the email domain and the back states the real registered name.
 */
function pickCompany(front: string, back: string): string {
  if (!front) return back;
  if (!back) return front;
  const f = letters(front);
  const b = letters(back);
  if (b.includes(f) && b.length > f.length) return back;
  return front;
}

export function mergeCardFields(front: CardFields, back: CardFields): CardFields {
  const dedupe = <T>(items: T[], key: (t: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((i) => {
      const k = key(i).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    name: front.name || back.name,
    role: front.role || back.role,
    company: pickCompany(front.company, back.company),
    emails: dedupe([...front.emails, ...back.emails], (e) => e),
    phones: dedupe([...front.phones, ...back.phones], (p) => p.replace(/\D/g, '')),
    links: dedupe([...front.links, ...back.links], (l) => l.url),
  };
}
