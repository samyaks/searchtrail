// A stand-in for the backend's query builder, so the Scope screen's live KQL changes as you type.
// NOT the real builder: the backend's `searchtrail.query` (build_kql, describe, validate) is the only place KQL is
// really built. This follows its shape, so the mock's KQL and methodology read like the real ones: each item type
// gets its own clause with only the filters that apply to it (dates by sent/received for emails and chats and by
// the chosen date for documents, domains on emails and chats only, file types on documents only), and label and
// term exclusions apply to everything. For the contract's own Falcon criteria the contract's example is returned
// unchanged.
import type { Schemas } from '@/api/client';
import { example } from './examples';
import { canonical } from './util';

type Criteria = Schemas['Criteria'];

/** Criteria that can't be turned into a query. `field` is the criteria field it is about, if there is one. */
export class CriteriaInvalid extends Error {
  constructor(
    message: string,
    readonly field: keyof Criteria | null = null,
  ) {
    super(message);
  }
}

const KIND_CLAUSES: Record<string, string> = { email: 'kind:email', chats: '(kind:microsoftteams OR kind:im)', docs: 'kind:docs' };
const KIND_NAMES: Record<string, string> = { email: 'emails', chats: 'Teams chats', docs: 'documents' };
const MESSAGE_KINDS = ['email', 'chats'];
const DOC_DATES: Record<string, string> = { lastmodifiedtime: 'last modified', created: 'created' };
const OPERATORS = ['AND', 'OR', 'NOT', 'NEAR', 'ONEAR'];
const MAX_QUERY_CHARS = 4000;

/** One search term as KQL: a single word (with an optional trailing *) stays bare, anything else is a phrase. */
export function quoteTerm(term: string): string {
  let t = term.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
  if (/^[\p{L}\p{N}_]+\*?$/u.test(t) && !OPERATORS.includes(t.toUpperCase())) return t;
  return `"${t}"`;
}

/** The parts joined with `op`, in parentheses when there is more than one; nothing for none. */
function group(parts: string[], op: 'AND' | 'OR'): string {
  const kept = parts.filter(Boolean);
  if (kept.length === 0) return '';
  if (kept.length === 1) return kept[0]!;
  return `(${kept.join(` ${op} `)})`;
}

const range = (prop: string, from: string | null, to: string | null) => group([from ? `${prop}>=${from}` : '', to ? `${prop}<=${to}` : ''], 'AND');
const dates = (props: string[], c: Criteria) => (c.date_from || c.date_to ? group(props.map((p) => range(p, c.date_from, c.date_to)), 'OR') : '');

function kindClause(kind: string, c: Criteria): string {
  const parts = [KIND_CLAUSES[kind]!];
  if (MESSAGE_KINDS.includes(kind)) {
    parts.push(dates(['sent', 'received'], c));
    parts.push(group(c.participant_domains.map((d) => `participants:${d}`), 'OR'));
    parts.push(...c.exclude_participant_domains.map((d) => `NOT participants:${d}`));
  } else {
    parts.push(dates([c.doc_date_property], c));
    parts.push(group(c.file_extensions.map((e) => `fileextension:${e}`), 'OR'));
  }
  return group(parts, 'AND');
}

/**
 * Checks on the criteria. The dates and the raw KQL's pairing are the backend's own (searchtrail/query.py
 * `CullCriteria.check`). The first, at least one search term or raw KQL, is the mock's only: the backend allows a
 * search with neither (and only warns that it is very broad); the mock refuses it so the screens' refusal states can
 * be tried.
 */
function check(c: Criteria) {
  if (c.keywords.length === 0 && !c.raw_kql) {
    throw new CriteriaInvalid('Add at least one search term, or a raw KQL query, so there is something to look for.');
  }
  if (c.date_from && c.date_to && c.date_from > c.date_to) {
    throw new CriteriaInvalid(`The From date (${c.date_from}) is after the To date (${c.date_to}), so nothing can match. Swap them or change one.`, 'date_from');
  }
  const rawProblem = c.raw_kql ? unbalanced(c.raw_kql) : null;
  if (rawProblem) {
    throw new CriteriaInvalid(`raw_kql ${rawProblem}. It is ANDed onto the query in parentheses, so its own parentheses and quotes must pair up.`, 'raw_kql');
  }
}

/** Label names for the methodology, from the tenant's labels in the contract's example. */
function labelName(id: string): string {
  const walk = (labels: Schemas['Label'][]): string | undefined => {
    for (const label of labels) {
      if (label.id === id) return label.path;
      const inner = walk(label.sublabels);
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(example<Schemas['LabelList']>('listLabels', '200').items) ?? id;
}

/** The plain-English methodology (searchtrail/query.py `describe`). */
function describe(c: Criteria): string[] {
  const lines = [`Item types: ${c.kinds.map((k) => KIND_NAMES[k]).join(', ')}.`];
  if (c.date_from || c.date_to) {
    let span = c.date_from ? `from ${c.date_from}` : '';
    span += (span ? ' ' : '') + (c.date_to ? `to ${c.date_to}` : 'onward');
    const basis: string[] = [];
    if (c.kinds.some((k) => MESSAGE_KINDS.includes(k))) basis.push('emails/chats by sent or received date');
    if (c.kinds.includes('docs')) basis.push(`documents by ${DOC_DATES[c.doc_date_property]} date`);
    lines.push(`Date range ${span} (inclusive): ${basis.join('; ')}.`);
  }
  if (c.keywords.length) {
    lines.push(`Containing ${c.keyword_mode === 'all' ? 'ALL' : 'ANY'} of these terms: ${c.keywords.map(quoteTerm).join(', ')}.`);
    if (c.keywords.some((k) => quoteTerm(k).endsWith('*'))) lines.push('Terms ending in * match any word starting with that stem.');
  }
  if (c.exclude_keywords.length) lines.push(`Excluding items containing any of: ${c.exclude_keywords.map(quoteTerm).join(', ')}.`);
  if (c.participant_domains.length) {
    lines.push(`Emails/chats limited to those with a participant at: ${c.participant_domains.join(', ')}. Documents are not filtered by domain.`);
  }
  if (c.exclude_participant_domains.length) lines.push(`Emails/chats excluded if a participant is at: ${c.exclude_participant_domains.join(', ')}.`);
  if (c.file_extensions.length) lines.push(`Documents limited to file types: ${c.file_extensions.join(', ')}.`);
  if (c.label_ids.length) lines.push(`Only items with these sensitivity labels: ${c.label_ids.map(labelName).join(', ')}. Items without a label are excluded.`);
  if (c.exclude_label_ids.length) lines.push(`Excluding items with these sensitivity labels: ${c.exclude_label_ids.map(labelName).join(', ')}.`);
  if (c.raw_kql) lines.push(`Additional expert query (ANDed): ${c.raw_kql.trim()}`);
  return lines;
}

/** Things that are allowed but worth a second look (searchtrail/query.py `validate`). */
function warningsFor(c: Criteria, kql: string): string[] {
  const warnings: string[] = [];
  if (kql.length > MAX_QUERY_CHARS) warnings.push(`Query is ${kql.length} characters; Purview may reject long queries (limit set to ${MAX_QUERY_CHARS}).`);
  for (const term of [...c.keywords, ...c.exclude_keywords]) {
    const stem = quoteTerm(term);
    if (stem.endsWith('*') && stem.length - 1 < 3) warnings.push(`Wildcard '${stem}' has a very short stem and may match a huge number of items.`);
  }
  if (c.participant_domains.length && c.kinds.includes('docs')) warnings.push('Domain filters apply to emails and chats only. Documents are not filtered by domain.');
  if (c.label_ids.length) warnings.push('A label filter is set, so items without a sensitivity label are excluded.');
  return warnings;
}

export function buildMockKql(criteria: Criteria): Schemas['KqlPreview'] {
  const falcon = example<Schemas['KqlPreviewRequest']>('previewKql', 'request');
  if (canonical(criteria) === canonical(falcon.criteria)) return example<Schemas['KqlPreview']>('previewKql', '200');
  check(criteria);
  const c = criteria;
  const clauses = [
    group(c.keywords.map(quoteTerm), c.keyword_mode === 'all' ? 'AND' : 'OR'),
    group(c.label_ids.map((g) => `InformationProtectionLabelId:${g}`), 'OR'),
    group(c.kinds.map((k) => kindClause(k, c)), 'OR'),
    ...c.exclude_label_ids.map((g) => `NOT InformationProtectionLabelId:${g}`),
    c.exclude_keywords.length ? `NOT ${group(c.exclude_keywords.map(quoteTerm), 'OR')}` : '',
    c.raw_kql ? `(${c.raw_kql.trim()})` : '',
  ];
  const kql = clauses.filter(Boolean).join(' AND ');
  return { kql, length: kql.length, methodology: describe(c), warnings: warningsFor(c, kql) };
}

/** The backend's rule for raw KQL (searchtrail/query.py `_unbalanced`): its parentheses and quotes must pair
 * up, or a stray ")" would close the wrapping parentheses and put an OR outside every other filter. */
function unbalanced(kql: string): string | null {
  let depth = 0;
  let quoted = false;
  for (const ch of kql) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')') {
      depth -= 1;
      if (depth < 0) return 'closes a parenthesis it never opened';
    }
  }
  if (quoted) return 'has a quote that is never closed';
  return depth ? 'opens a parenthesis it never closes' : null;
}
