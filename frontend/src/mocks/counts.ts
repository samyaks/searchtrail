// Plausible counts for the mock's estimates and term reports: the same every time for the same criteria, and
// behaving the way real searches do when terms change. Each term has its own hits within the other filters; the
// query's total is their union. So adding an OR term never lowers the total or another term's hits, and removing
// one never raises them (with ALL terms, adding one never raises the total). Only the terms' own hits and the
// non-term filters decide the numbers.
//
// A term only finds anything if the seeded mailboxes and sites plausibly contain it: its words are in the small
// vocabulary below (the words of the seeded items' subjects and the business mail around them) or the matter's own
// (its name and its seeded terms). A term like `zzznomatch` finds 0 items, so adding it changes nothing.
//
// The Falcon matter is calibrated on the contract's examples: its seeded term report (105, 440, 258 and 316
// hits) combines to exactly the 630 items of query v3, so editing v3's terms moves the numbers from there.
import type { Schemas } from '@/api/client';
import type { MockMatter } from './db';
import { makeCounts } from './db';
import { quoteTerm } from './kql';
import { canonical, hashNumber } from './util';

type Criteria = Schemas['Criteria'];

/** How much the terms' hits overlap: the union is the biggest term's hits plus this share of the others'. The
 * contract's Falcon v3 report gives it: 440 + OVERLAP × (105 + 258 + 316) = 630. */
const OVERLAP = 190 / 679;
/** With ALL terms, each extra term keeps this share of the items the fewest-hits term finds. */
const ALL_KEEP = 0.6;

/** What a matter's counts are anchored to: a query version with known counts, and the hits of its terms if known. */
export type CountAnchor = { criteria: Criteria; items: number; hits?: Record<string, number> };

const bare = (term: string) => quoteTerm(term).replace(/^"|"$/g, '');

/** What the seeded mailboxes and sites contain: the words of the Falcon items' subjects, and everyday business mail. */
const CORPUS = new Set(
  `falcon project supplier suppliers payment payments schedule side letter invoice invoices numbering brightline kickback
  kickbacks allegations allegation hotline report reconciliation steering committee notes approvals approval close
  contract contracts agreement wire transfer bank account vendor vendors purchase order budget forecast meeting minutes
  board audit compliance finance legal confidential bonus commission refund rebate discount consulting fee fees expense
  expenses receipt quarterly q3 trading records employment termination complaint offer salary delivery shipment dispute
  regulator request overtime contoso review draft memo policy out offshore`.split(/\s+/),
);
/** Words that don't decide whether a phrase is found: a phrase is found if its other words are. */
const STOP_WORDS = new Set('a an and at by for from in of on or the to with re fw please do not'.split(' '));

/** The words a matter's own items plausibly contain: the corpus, the matter's name and its seeded terms. */
function vocabularyOf(m: MockMatter): Set<string> {
  const own = [m.matter.name, ...(m.anchor?.criteria.keywords ?? [])].flatMap((text) => wordsOf(text));
  return new Set([...CORPUS, ...own.filter((w) => !w.endsWith('*'))]);
}
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}*]+/u).filter(Boolean);

/** Whether a term plausibly finds anything in the matter's items: every word of it (but the stop words) is known, a
 * word ending in * standing for any known word it starts. */
function isKnown(vocabulary: Set<string>, term: string): boolean {
  const words = wordsOf(bare(term)).filter((w) => !STOP_WORDS.has(w));
  if (words.length === 0) return false;
  const known = (w: string) => {
    if (w.endsWith('*')) {
      const stem = w.slice(0, -1);
      return stem.length > 0 && !stem.includes('*') && [...vocabulary].some((v) => v.startsWith(stem));
    }
    return vocabulary.has(w) || vocabulary.has(w.replace(/s$/, '')) || vocabulary.has(`${w}s`);
  };
  return words.every(known);
}
/** Everything but the terms, as text, so two criteria with the same other filters compare equal. */
const filtersOf = (c: Criteria) => canonical({ ...c, keywords: [], keyword_mode: 'any' });

/** A term's hits before the filters: the anchor's own count for it if there is one, else a steady made-up number. */
function baseHits(anchor: CountAnchor | undefined, term: string): number {
  return anchor?.hits?.[bare(term)] ?? 20 + (hashNumber(`term:${bare(term)}`) % 400);
}

/** How the non-term filters scale the hits: 1 for the anchor's own filters, a steady made-up factor for others. */
function filterFactor(anchor: CountAnchor | undefined, c: Criteria): number {
  if (anchor && filtersOf(anchor.criteria) === filtersOf(c)) return 1;
  return 0.4 + (hashNumber(`filters:${filtersOf(c)}`) % 900) / 1000;
}

function union(hits: number[], mode: Criteria['keyword_mode']): number {
  if (hits.length === 0) return 0;
  if (mode === 'all') return Math.min(...hits) * ALL_KEEP ** (hits.length - 1);
  const max = Math.max(...hits);
  return max + OVERLAP * (hits.reduce((a, b) => a + b, 0) - max);
}

/** Scales the made-up hits so the anchor's own criteria give the anchor's own count. */
function scaleOf(anchor: CountAnchor | undefined): number {
  if (!anchor || anchor.hits || anchor.criteria.keywords.length === 0) return 1;
  const raw = union(anchor.criteria.keywords.map((t) => baseHits(anchor, t)), anchor.criteria.keyword_mode);
  return raw > 0 ? anchor.items / raw : 1;
}

/** Hits for one term, counted within every other filter of `criteria`: 0 for a term the matter's items don't contain. */
export function termHits(m: MockMatter, criteria: Criteria, term: string): number {
  if (!isKnown(vocabularyOf(m), term)) return 0;
  return Math.max(1, Math.round(baseHits(m.anchor, term) * scaleOf(m.anchor) * filterFactor(m.anchor, criteria)));
}

/** The counts an estimate of `criteria` finds. */
export function estimateCounts(m: MockMatter, criteria: Criteria): Schemas['Counts'] {
  const custodians = Math.max(1, m.matter.custodians.length);
  if (criteria.keywords.length === 0) {
    // Only raw KQL: a steady number for its text, within the filters.
    const items = Math.round((60 + (hashNumber(`raw:${criteria.raw_kql ?? ''}`) % 400)) * scaleOf(m.anchor) * filterFactor(m.anchor, criteria));
    return makeCounts(items, Math.floor(items / 25), custodians);
  }
  const items = Math.round(union(criteria.keywords.map((t) => termHits(m, criteria, t)), criteria.keyword_mode));
  return makeCounts(items, Math.floor(items / 25), custodians);
}
