import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  /** A short heading, for a screen with nothing at all on it ("No matters yet"). Leave it out inside a table or a list. */
  title?: string;
  /** What is missing, and what to do ("No matters match. Clear the search or choose All."). */
  children: ReactNode;
  /** A button or link that fixes it. */
  action?: ReactNode;
};

/** Nothing to show, and why: for an empty table, list or screen. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {title && <p className={styles.title}>{title}</p>}
      <p className={styles.text}>{children}</p>
      {action}
    </div>
  );
}
