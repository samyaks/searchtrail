import type { ReactNode } from 'react';
import styles from './Banner.module.css';

export type BannerProps = {
  /**
   * `notice` (the highlighter) tells the person something changed and what happens next. `warning` (red) tells
   * them about something they are choosing that they should be sure of.
   */
  tone?: 'notice' | 'warning';
  /** The first words, in bold ("Who is searched has changed."). */
  title?: string;
  /** Buttons that deal with it ("Estimate v4"). */
  actions?: ReactNode;
  /** `status` is announced politely (default for a notice); `alert` interrupts (default for a warning). */
  role?: 'status' | 'alert';
  children: ReactNode;
};

/** A message in the page: a notice that something changed, or a warning about a choice. For a request that failed, use ErrorNotice. */
export function Banner({ tone = 'notice', title, actions, role, children }: BannerProps) {
  return (
    <div className={styles.banner} data-tone={tone} role={role ?? (tone === 'warning' ? 'alert' : 'status')}>
      <p className={styles.text}>
        {title && <strong>{title} </strong>}
        {children}
      </p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

/** A message under a field that has a problem ("Enter a term"). Announced as soon as it appears. */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={styles.inline}>
      {children}
    </p>
  );
}
