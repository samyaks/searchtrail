import type { ReactNode } from 'react';
import styles from './CountTile.module.css';

export type CountTileProps = {
  /** What is counted ("Items matching"). */
  label: string;
  /** The count. A number is written with thousands separators (1,206); text is shown as given. */
  value: number | string;
  /** A line under the count: a size, or what it means ("Reviewers may not be able to open these"). */
  note?: ReactNode;
  /** `ok` marks the note as good news, with a green dot ("21.7 MB · included in export"). */
  noteTone?: 'muted' | 'ok';
};

/** One big number with its label: a tile of the preview, the export summary or the estimate. Put tiles in a TileGrid. */
export function CountTile({ label, value, note, noteTone = 'muted' }: CountTileProps) {
  return (
    <div className={styles.tile}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</dd>
      {note !== undefined && (
        <dd className={styles.note} data-tone={noteTone}>
          {noteTone === 'ok' && <span aria-hidden="true" className={styles.dot} />}
          {note}
        </dd>
      )}
    </div>
  );
}

/** A row of CountTiles that wraps as the screen narrows. It is a description list: each tile is a term and its value. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <dl className={styles.grid}>{children}</dl>;
}
