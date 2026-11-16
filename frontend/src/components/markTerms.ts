// Marking the search terms in the methodology's text, apart from the component so it can be tested.

export type Piece = { text: string; term: boolean };

const TERMS_LINE = /^Containing (?:ANY|ALL) of these terms: /;

/**
 * Cut a line into pieces, marking the ones that are search terms. Only the line that lists the search terms is
 * marked, so a word that is also in an exclusion isn't. The longest term is tried first, so `invoic*` can't be
 * cut short by a term `invoic`.
 */
export function markTerms(line: string, terms: readonly string[]): Piece[] {
  const listed = TERMS_LINE.exec(line);
  const usable = terms.filter(Boolean); // an empty term would match everywhere
  if (!listed || usable.length === 0) return [{ text: line, term: false }];
  const head = listed[0].length;
  const pattern = [...usable]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const pieces: Piece[] = [{ text: line.slice(0, head), term: false }];
  let from = head;
  for (const match of line.slice(head).matchAll(new RegExp(pattern, 'g'))) {
    const start = head + match.index;
    if (start > from) pieces.push({ text: line.slice(from, start), term: false });
    pieces.push({ text: match[0], term: true });
    from = start + match[0].length;
  }
  if (from < line.length) pieces.push({ text: line.slice(from), term: false });
  return pieces;
}
