import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

export type FilterChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  /** Whether the filter is on. Exposed to screen readers as a toggle button. */
  pressed: boolean;
  /** How many items match, shown after the label ("Previewed 3"). */
  count?: number;
};

/** A filter that can be switched on, like the stage chips above the Matters list. */
export function FilterChip({ pressed, count, children, className, type = 'button', ...rest }: FilterChipProps) {
  return (
    <button {...rest} type={type} aria-pressed={pressed} className={[styles.filter, className].filter(Boolean).join(' ')}>
      {children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}

export type PillTone = 'neutral' | 'highlight' | 'ink' | 'ok' | 'danger';

/** A state shown as a pill (Scoping, Previewed, Exporting 64%, Exported). The text carries the meaning; the tone is extra. */
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {children}
    </span>
  );
}

/** A labelled list of removable chips (search terms, exclusions, file types). */
export function ChipList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

export type RemovableChipProps = {
  /** `term` is a search term (highlighter, monospace); `exclude` is struck through; `plain` is a file type or domain. */
  tone?: 'term' | 'exclude' | 'plain';
  /** Names the remove button: "Remove invoic*". Required, because the button shows only an X. */
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
};

/** One item in a ChipList, with a button to remove it. */
export function RemovableChip({ tone = 'plain', removeLabel, onRemove, children }: RemovableChipProps) {
  return (
    <li className={styles.removable} data-tone={tone}>
      <span>{children}</span>
      <button type="button" className={styles.remove} aria-label={removeLabel} onClick={onRemove}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </li>
  );
}
