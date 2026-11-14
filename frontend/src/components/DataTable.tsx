import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export type Column<Row> = {
  /** Unique within the table. */
  key: string;
  /** The column's name. Keep it short; it is shown in capitals. */
  header: string;
  /** What to show in this column for a row. */
  cell: (row: Row) => ReactNode;
  /** Right-aligned digits that line up (counts, sizes). */
  numeric?: boolean;
  /** Make this column's cells row headers, so a screen reader announces "Project Falcon, Stage: Previewed". Use on the name column. */
  rowHeader?: boolean;
  /** Keep the header for screen readers only, for a column that holds buttons. */
  hideHeader?: boolean;
  /** A CSS width, such as "150px" or "40%". */
  width?: string;
};

export type DataTableProps<Row> = {
  /** Names the table for screen readers ("Matters"). */
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** The key of the row to highlight (aria-current marks it for screen readers). */
  selectedKey?: string;
  /** Shown instead of rows when there are none. */
  emptyMessage?: ReactNode;
};

/** A table in the design's style. A real <table>, so screen readers can move by row and column. */
export function DataTable<Row>({ caption, columns, rows, rowKey, selectedKey, emptyMessage = 'Nothing to show.' }: DataTableProps<Row>) {
  return (
    // A wide table scrolls inside this region, which must be reachable by keyboard.
    <div className={styles.scroll} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.table}>
        <caption className="st-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined} data-numeric={column.numeric || undefined}>
                {column.hideHeader ? <span className="st-visually-hidden">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            return (
              <tr key={key} data-selected={selected || undefined} aria-current={selected || undefined}>
                {columns.map((column) =>
                  column.rowHeader ? (
                    <th key={column.key} scope="row" data-numeric={column.numeric || undefined}>
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td key={column.key} data-numeric={column.numeric || undefined}>
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
