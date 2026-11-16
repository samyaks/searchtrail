import { useId } from 'react';
import styles from './BarBreakdown.module.css';

export type Bar = {
  /** Identifies the bar to `onSelect` and `selectedKey`. */
  key: string;
  label: string;
  count: number;
  /** A grey bar, for items that don't belong to any of the others ("No label"). */
  quiet?: boolean;
};

export type BarBreakdownProps = {
  /** What the bars split the items by ("By type"). */
  title: string;
  bars: readonly Bar[];
  /** The bar that is chosen as a filter, if any. */
  selectedKey?: string | null;
  /** Makes each bar a button that filters. Called with the bar's key, or null when the chosen bar is chosen again. Without it, the bars are only a picture. */
  onSelect?: (key: string | null) => void;
  /** The heading level; use the one that follows the page's headings. */
  headingLevel?: 2 | 3 | 4;
};

/**
 * Items split by one thing (custodian, type, label): a bar for each, as long as its count compared with the
 * largest. With `onSelect`, choosing a bar filters the item list by it, and choosing it again clears the filter.
 */
export function BarBreakdown({ title, bars, selectedKey = null, onSelect, headingLevel = 3 }: BarBreakdownProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  const largest = Math.max(0, ...bars.map((bar) => bar.count));
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <Heading id={titleId} className={styles.title}>
        {title}
      </Heading>
      {bars.length === 0 ? (
        <p className={styles.none}>Nothing to show.</p>
      ) : (
        <ul className={styles.list}>
          {bars.map((bar) => {
            const selected = bar.key === selectedKey;
            const content = (
              <>
                <span className={styles.name} title={bar.label}>
                  {bar.label}
                </span>
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.fill} data-quiet={bar.quiet || undefined} style={{ width: `${largest === 0 ? 0 : (bar.count / largest) * 100}%` }} />
                </span>
                <span className={styles.count}>{bar.count.toLocaleString('en-US')}</span>
              </>
            );
            return (
              <li key={bar.key}>
                {onSelect ? (
                  <button type="button" className={styles.row} aria-pressed={selected} onClick={() => onSelect(selected ? null : bar.key)}>
                    {content}
                  </button>
                ) : (
                  <div className={styles.row}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
