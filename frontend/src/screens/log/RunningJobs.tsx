// Jobs running on this matter, started here or elsewhere (another tab, another person): their entries are written
// when they finish. The running list is asked about often while a job runs and every few seconds while none does
// (useRunningJobs), so a job started elsewhere shows up without a reload. While one runs it is shown with its
// progress, and when it leaves the running list, everything on this matter is read again, so its new entry, a new
// version and a fresh chain check appear.
//
// Screen readers hear only that a job started or finished: the live region below stays mounted (a region added to
// the page along with its text is often not announced) and holds no progress, which would be read out at every poll.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Schemas } from '@/api/client';
import { JOB_LABELS } from './format';
import { useRunningJobs } from './hooks';
import styles from './LogScreen.module.css';

export function RunningJobs({ matterId }: { matterId: string }) {
  const client = useQueryClient();
  const jobs = useRunningJobs(matterId);
  const items = jobs.data?.items ?? [];
  const [announcement, setAnnouncement] = useState('');

  // The jobs seen running at the last answer, by id (null until the first answer).
  const running = useRef<Map<string, Schemas['JobKind']> | null>(null);
  useEffect(() => {
    if (!jobs.data) return;
    const now = new Map(jobs.data.items.map((job) => [job.id, job.kind]));
    const before = running.current;
    running.current = now;
    // Jobs already running when the screen opens are shown, not announced.
    if (before === null) return;
    const ended = [...before].filter(([id]) => !now.has(id));
    const started = [...now].filter(([id]) => !before.has(id));
    if (ended.length > 0) void client.invalidateQueries({ queryKey: ['matters', matterId] });
    const news = [...started.map(([, kind]) => `${JOB_LABELS[kind]} started.`), ...ended.map(([, kind]) => `${JOB_LABELS[kind]} finished.`)];
    if (news.length > 0) setAnnouncement(news.join(' '));
  }, [client, jobs.data, matterId]);

  return (
    <>
      <div role="status" aria-label="Job updates" className="st-visually-hidden">
        {announcement}
      </div>
      {items.length > 0 && (
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
      )}
    </>
  );
}
