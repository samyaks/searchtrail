// A stand-in for the backend's query builder, so the Scope screen's live KQL changes as you type.
// NOT the real builder: the backend's `searchtrail.query` is the only place KQL is really built, and the real
// text differs. For the contract's own Falcon criteria the contract's example is returned unchanged.
import type { Schemas } from '@/api/client';
import { example } from './examples';

type Criteria = Schemas['Criteria'];

export class CriteriaInvalid extends Error {}

const quote = (term: string) => (/\s/.test(term) ? `"${term}"` : term);
const list = (items: string[]) => items.map(quote).join(', ');

export function buildMockKql(criteria: Criteria): Schemas['KqlPreview'] {
  const falcon = example<Schemas['KqlPreviewRequest']>('previewKql', 'request');
  if (JSON.stringify(criteria) === JSON.stringify(falcon.criteria)) return example<Schemas['KqlPreview']>('previewKql', '200');

  if (criteria.keywords.length === 0 && !criteria.raw_kql) {
    throw new CriteriaInvalid('Add at least one search term, or a raw KQL query, so there is something to look for.');
  }
  const joiner = criteria.keyword_mode === 'all' ? ' AND ' : ' OR ';
  const parts: string[] = [];
  const methodology: string[] = [];
  const kinds: Record<string, string> = { email: 'emails', chats: 'Teams chats', docs: 'documents' };
  methodology.push(`Item types: ${criteria.kinds.map((k) => kinds[k]).join(', ')}.`);
  if (criteria.date_from || criteria.date_to) {
    methodology.push(`Date range from ${criteria.date_from ?? 'the start'} to ${criteria.date_to ?? 'today'} (inclusive).`);
    parts.push(`(sent>=${criteria.date_from ?? '*'} AND sent<=${criteria.date_to ?? '*'})`);
  }
  if (criteria.keywords.length) {
    parts.unshift(`(${criteria.keywords.map(quote).join(joiner)})`);
    methodology.push(`Containing ${criteria.keyword_mode === 'all' ? 'ALL' : 'ANY'} of these terms: ${list(criteria.keywords)}.`);
  }
  if (criteria.exclude_keywords.length) {
    parts.push(...criteria.exclude_keywords.map((t) => `NOT ${quote(t)}`));
    methodology.push(`Excluding items containing any of: ${list(criteria.exclude_keywords)}.`);
  }
  if (criteria.file_extensions.length) {
    parts.push(`(${criteria.file_extensions.map((e) => `fileextension:${e}`).join(' OR ')})`);
    methodology.push(`Documents limited to file types: ${criteria.file_extensions.join(', ')}.`);
  }
  if (criteria.exclude_participant_domains.length) {
    methodology.push(`Emails/chats excluded if a participant is at: ${criteria.exclude_participant_domains.join(', ')}.`);
  }
  if (criteria.raw_kql) parts.push(`(${criteria.raw_kql})`);
  const kql = parts.join(' AND ');
  const warnings = kql.length > 3000 ? ['This query is long. Purview may reject queries over about 4,000 characters.'] : [];
  return { kql, length: kql.length, methodology, warnings };
}
