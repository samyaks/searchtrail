import { type ReactNode, type Ref, useId } from 'react';
import styles from './DefineScreen.module.css';

/**
 * A white panel with a heading, as the Define design draws each group (17px bold heading, an optional note beside it).
 * With `headingRef`, the heading can be given focus (when what had focus in the section has gone).
 */
export function Section({ title, note, headingRef, children }: { title: string; note?: string; headingRef?: Ref<HTMLHeadingElement>; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title}
        </h2>
        {note && <span className={styles.muted}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}

export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5l3 3 6-7" />
    </svg>
  );
}
