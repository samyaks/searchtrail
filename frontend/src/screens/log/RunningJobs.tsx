// Jobs running on this matter (started here, or on another tab): their entries are written when they finish. While
// one runs it is shown with its progress, and when it leaves the running list, everything on this matter is read
// again, so its new entry, a new version and a fresh chain check appear without a reload.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useMatterJobs } from '@/api/jobs';
import { JOB_LABELS } from './format';
import { logPolling } from './hooks';
import styles from './LogScreen.module.css';

export function RunningJobs({ matterId }: { matterId: string }) {
  const client = useQueryClient();
  const jobs = useMatterJobs(matterId, { active: true }, { pollMs: (count) => logPolling.pollMs(count) });
  const items = jobs.data?.items ?? [];

  const running = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!jobs.data) return;
    const now = new Set(jobs.data.items.map((job) => job.id));
    const ended = [...running.current].some((id) => !now.has(id));
    running.current = now;
    if (ended) void client.invalidateQueries({ queryKey: ['matters', matterId] });
  }, [client, jobs.data, matterId]);

  if (items.length === 0) return null;
  return (
    <div role="status">
      <ul className={styles.runningList} aria-label="Running now">
        {items.map((job) => {
          const percent = Math.round(job.progress * 100);
          return (
            <li key={job.id} className={styles.running}>
              <span className={styles.runningText}>
                {JOB_LABELS[job.kind]} is running ({percent}%). Its entry is added here when it finishes.
              </span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.bar} data-current="" style={{ width: `${Math.max(2, percent)}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
