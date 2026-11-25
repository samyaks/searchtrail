import styles from './ExportScreen.module.css';

/** A thin bar for a job's progress, with the percentage in words beside it. */
export function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={styles.progress}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={styles.progressTrack}>
        <span className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      <span className={styles.progressText}>{percent}%</span>
    </div>
  );
}
