import { useId } from 'react';
import styles from './PreviewScreen.module.css';

/** A preview job that is running: how far along it is. It carries on if the person leaves the screen. */
export function JobProgress({ progress, version }: { progress: number; version: number | null }) {
  const headingId = useId();
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <section aria-labelledby={headingId} className={styles.progressCard}>
      <h2 id={headingId} className={styles.progressTitle}>
        {version === null ? 'Building the preview' : `Previewing query v${version}`}
      </h2>
      <div
        role="progressbar"
        aria-labelledby={headingId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        className={styles.progressTrack}
      >
        <span className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.muted}>
        {percent}% · Purview is building the item report. This can take a while; you can leave this screen and come back.
      </p>
    </section>
  );
}
