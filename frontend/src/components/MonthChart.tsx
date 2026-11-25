import { type CSSProperties, type ReactNode, useId } from 'react';
import { BAR_AREA, monthName, parseMonth, SHORT_MONTHS, describeMonths } from './monthSummary';
import styles from './MonthChart.module.css';

export type MonthCount = { month: string; count: number };

export type MonthChartProps = {
  /** The chart's heading ("By month"). */
  title: string;
  /** One entry per month, oldest first, as "YYYY-MM" and a count. Months with no items are included, as zero. */
  months: readonly MonthCount[];
  /** Beside the heading: what the months cover ("Jan 2024 to Jun 2025, the date range in the query"). */
  note?: ReactNode;
  headingLevel?: 2 | 3;
};

/**
 * Items per month as columns, each with its count above it, the busiest month in black. It is a picture to a
 * screen reader, with a sentence saying the span, the lowest and the highest month; the same numbers are also
 * there as a table that is only read aloud, never shown. It scrolls sideways on a narrow screen.
 */
export function MonthChart({ title, months, note, headingLevel = 2 }: MonthChartProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  const largest = Math.max(0, ...months.map((m) => m.count));
  const columns = { '--months': months.length } as CSSProperties;
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.header}>
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      {months.length === 0 ? (
        <p className={styles.none}>No dated items to chart.</p>
      ) : (
        <>
          <div className={styles.scroll}>
            <div className={styles.chart} style={columns} role="img" aria-label={describeMonths(months)}>
              {months.map((m) => (
                <div key={m.month} className={styles.column}>
                  <span className={styles.value}>{m.count}</span>
                  <span
                    className={styles.bar}
                    data-peak={m.count === largest && largest > 0 ? '' : undefined}
                    style={{ height: `${largest === 0 ? 0 : Math.round((m.count / largest) * BAR_AREA)}px` }}
                  />
                </div>
              ))}
            </div>
            <div className={styles.axis} style={columns} aria-hidden="true">
              {months.map((m, i) => {
                const { year, index } = parseMonth(m.month);
                return (
                  <span key={m.month} className={styles.tick}>
                    <span>{SHORT_MONTHS[index] ?? m.month}</span>
                    <span className={styles.year}>{i === 0 || index === 0 ? year : ' '}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <table className="st-visually-hidden">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Items</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthName(m.month)}</th>
                  <td>{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
