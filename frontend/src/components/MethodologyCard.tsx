import { Fragment } from 'react';
import { markTerms } from './markTerms';
import styles from './MethodologyCard.module.css';

export type MethodologyCardProps = {
  /** The methodology, one statement per line, as the API writes it (the `methodology` of a KQL preview or a query version). */
  lines: readonly string[];
  /** The search terms, written as they appear in the "Containing ANY of these terms" line (`"project falcon"`, `invoic*`), to mark in yellow. */
  terms?: readonly string[];
  /** A title page above the lines: "CULLING METHODOLOGY", then the matter and the query version. Leave it out for a card that sits under a heading of its own. */
  heading?: { matter: string; version?: string };
};

// More numbers than a card is ever tall: the extra ones are cut off by the card's edge.
const LINE_NUMBERS = Array.from({ length: 80 }, (_, i) => i + 1);

/**
 * The culling methodology on pleading paper: line numbers down the left, a double red rule, Courier Prime, the
 * search terms marked in yellow. It is the text that goes into the log and the export, so it reads as a record.
 */
export function MethodologyCard({ lines, terms = [], heading }: MethodologyCardProps) {
  return (
    <div className={styles.paper}>
      <span aria-hidden="true" className={styles.rule} data-edge="left-outer" />
      <span aria-hidden="true" className={styles.rule} data-edge="left-inner" />
      <span aria-hidden="true" className={styles.rule} data-edge="right" />
      <div aria-hidden="true" className={styles.numbers}>
        {LINE_NUMBERS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <div className={styles.text}>
        {heading && (
          <>
            <div className={styles.title}>CULLING METHODOLOGY</div>
            <div className={styles.subtitle}>
              Matter {heading.matter}
              {heading.version ? ` · ${heading.version}` : ''}
            </div>
          </>
        )}
        <ol className={styles.lines} data-after-heading={heading ? '' : undefined}>
          {lines.map((line, i) => (
            <li key={i}>
              {markTerms(line, terms).map((piece, j) => (
                <Fragment key={j}>{piece.term ? <mark className={styles.mark}>{piece.text}</mark> : piece.text}</Fragment>
              ))}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
