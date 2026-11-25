import styles from './ExportScreen.module.css';

/** The round mark before a check: a tick (passed), a cross (failed) or a dash (not checked). */
export function CheckMark({ status }: { status: 'passed' | 'failed' | 'skipped' }) {
  return (
    <span aria-hidden="true" className={styles.mark} data-status={status}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {status === 'passed' && <path d="M2.5 7.5l3 3 6-7" />}
        {status === 'failed' && <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />}
        {status === 'skipped' && <path d="M3.5 7h7" />}
      </svg>
    </span>
  );
}
