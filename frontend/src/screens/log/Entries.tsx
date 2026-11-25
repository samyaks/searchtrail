// The log itself, newest first and paged, each entry with the hash before it and its own.
import { useEffect, useRef } from 'react';
import type { Schemas } from '@/api/client';
import { Button, Card, EmptyState, ErrorNotice } from '@/components';
import { ACTION_LABELS, actionTone, n, shortHash, whenText } from './format';
import { LOG_PAGE_SIZE } from './hooks';
import styles from './LogScreen.module.css';
import { RunningJobs } from './RunningJobs';

type Props = {
  matterId: string;
  data: Schemas['LogEntryPage'] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onPage: (page: number) => void;
  /** The entry that failed the chain check, if one did. */
  badSeq: number | null;
  /** An entry to bring into view and focus once it is on the page ("Show entry 5"). */
  focusSeq: number | null;
  onFocused: () => void;
};

function Entry({ entry, bad, focus, onFocused }: { entry: Schemas['LogEntry']; bad: boolean; focus: boolean; onFocused: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focus || !ref.current) return;
    ref.current.scrollIntoView?.({ block: 'center' });
    ref.current.focus();
    onFocused();
  }, [focus, onFocused]);
  return (
    <li ref={ref} tabIndex={bad ? -1 : undefined} className={styles.entry} data-bad={bad ? '' : undefined} aria-label={`Entry ${entry.seq}`}>
      <span className={styles.seq}>{entry.seq}</span>
      <span className={styles.entryBody}>
        <span className={styles.entryHead}>
          <span className={styles.badge} data-tone={actionTone(entry.action)}>
            {ACTION_LABELS[entry.action] ?? entry.action}
          </span>
          <span className={styles.summary}>{entry.summary}</span>
        </span>
        <span className={styles.muted}>
          {whenText(entry.ts)} · <span title={entry.actor_email ?? undefined}>{entry.actor}</span>
        </span>
        <span className={styles.hashes}>
          prev <span title={entry.prev_hash}>{shortHash(entry.prev_hash)}</span> → hash <span title={entry.hash}>{shortHash(entry.hash)}</span>
        </span>
        {bad && <span className={styles.badNote}>This entry fails the check: it was changed, removed or reordered after it was written.</span>}
      </span>
    </li>
  );
}

export function Entries({ matterId, data, loading, error, onRetry, onPage, badSeq, focusSeq, onFocused }: Props) {
  const pages = data ? Math.max(1, Math.ceil(data.total / LOG_PAGE_SIZE)) : 1;
  const first = data ? (data.page - 1) * LOG_PAGE_SIZE + 1 : 0;
  const last = data ? first + data.items.length - 1 : 0;
  return (
    <Card title="Entries" padding="none">
      <div className={styles.entriesBody} aria-busy={loading}>
        <RunningJobs matterId={matterId} />
        {error !== null && error !== undefined && !data && (
          <div className={styles.pad}>
            <ErrorNotice error={error} matterId={matterId} onRetry={onRetry} headingLevel={3} />
          </div>
        )}
        {!data && !error && <p className={styles.pad}>Loading the log…</p>}
        {data && data.total === 0 && (
          <div className={styles.pad}>
            <EmptyState>Nothing has been logged on this matter yet.</EmptyState>
          </div>
        )}
        {data && data.items.length > 0 && (
          <ol className={styles.entries} aria-label="Log entries, newest first">
            {data.items.map((entry) => (
              <Entry key={entry.seq} entry={entry} bad={entry.seq === badSeq} focus={entry.seq === focusSeq} onFocused={onFocused} />
            ))}
          </ol>
        )}
        {data && pages > 1 && (
          <nav className={styles.pager} aria-label="Log pages">
            <span className={styles.muted}>
              Entries {n(first)}–{n(last)} of {n(data.total)}
            </span>
            <span className={styles.actions}>
              <Button size="sm" variant="neutral" disabled={data.page <= 1 || loading} onClick={() => onPage(data.page - 1)}>
                Newer
              </Button>
              <Button size="sm" variant="neutral" disabled={data.page >= pages || loading} onClick={() => onPage(data.page + 1)}>
                Older
              </Button>
            </span>
          </nav>
        )}
      </div>
    </Card>
  );
}
