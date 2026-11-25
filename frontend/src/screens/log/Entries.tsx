// The log itself, newest first and paged, each entry with the hash before it and its own.
import { useEffect, useId, useRef } from 'react';
import { describeError } from '@/api/errors';
import type { Schemas } from '@/api/client';
import { Button, Card, EmptyState, ErrorNotice } from '@/components';
import { ACTION_LABELS, actionTone, n, shortHash, whenText } from './format';
import { LOG_PAGE_SIZE } from './hooks';
import styles from './LogScreen.module.css';
import { RunningJobs } from './RunningJobs';

type Props = {
  matterId: string;
  /** The page to show: the one asked for, or the last one read if it can't be read. */
  data: Schemas['LogEntryPage'] | undefined;
  /** The page asked for (it differs from `data`'s while it loads, or when it can't be read). */
  page: number;
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
  const id = useId();
  useEffect(() => {
    if (!focus || !ref.current) return;
    ref.current.scrollIntoView?.({ block: 'center' });
    ref.current.focus();
    onFocused();
  }, [focus, onFocused]);
  return (
    <li ref={ref} tabIndex={bad ? -1 : undefined} className={styles.entry} data-bad={bad ? '' : undefined} aria-labelledby={`${id}-word ${id}-seq`}>
      {/* Named "Entry 8" from its own text, so the entry's content is still read with it. */}
      <span className={styles.seq}>
        <span id={`${id}-word`} className="st-visually-hidden">
          Entry{' '}
        </span>
        <span id={`${id}-seq`}>{entry.seq}</span>
      </span>
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

export function Entries({ matterId, data, page, loading, error, onRetry, onPage, badSeq, focusSeq, onFocused }: Props) {
  const failed = error !== null && error !== undefined;
  const pageSize = data?.page_size || LOG_PAGE_SIZE;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const first = data ? (data.page - 1) * pageSize + 1 : 0;
  const last = data ? first + data.items.length - 1 : 0;

  // After Newer or Older, or a "Try again" that works, focus moves to the new page's list, so it is read from its top
  // (the button pressed may now be unusable or gone). The buttons are aria-disabled rather than disabled, so focus
  // is never dropped while a page loads. A read that fails, or an entry asked for ("Show entry 5"), which takes focus
  // itself, lets the wish go, so the list can't take focus later on its own.
  const list = useRef<HTMLOListElement>(null);
  const focusPage = useRef<number | null>(null);
  useEffect(() => {
    if (focusPage.current === null || loading) return;
    const wanted = focusPage.current;
    focusPage.current = null;
    if (focusSeq === null && data?.page === wanted) list.current?.focus();
    // focusSeq is read, not watched: only a page read ending should move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.page, loading]);
  const go = (next: number, allowed: boolean) => {
    if (!allowed || loading) return;
    focusPage.current = next;
    onPage(next);
  };
  const retry = () => {
    if (loading) return;
    focusPage.current = page;
    onRetry();
  };
  const canNewer = data !== undefined && data.page > 1;
  const canOlder = data !== undefined && data.page < pages;

  return (
    <Card title="Entries" padding="none">
      {/* Only the entries are marked busy while a page loads: the job updates' live region, outside them, is busy
          exactly when a finished job has the log read again, and a busy region's news may not be read out. */}
      <div className={styles.entriesBody}>
        <RunningJobs matterId={matterId} />
        {failed && !data && (
          <div className={styles.pad}>
            <ErrorNotice error={error} matterId={matterId} onRetry={retry} headingLevel={3} />
          </div>
        )}
        {failed && data && (
          // The entries read last stay on screen; this says they could not be read just now.
          <div role="alert" className={styles.inlineError}>
            <span>
              The log couldn&apos;t be read just now: {describeError(error, { matterId }).message.trim().replace(/\.$/, '')}. The
              entries below are the last ones read.
            </span>
            <Button size="sm" variant="neutral" aria-disabled={loading} onClick={retry}>
              Try again
            </Button>
          </div>
        )}
        {!data && !failed && <p className={styles.pad}>Loading the log…</p>}
        {data && data.total === 0 && (
          <div className={styles.pad}>
            <EmptyState>Nothing has been logged on this matter yet.</EmptyState>
          </div>
        )}
        {data && data.items.length > 0 && (
          <ol ref={list} tabIndex={-1} className={styles.entries} aria-label="Log entries, newest first" aria-busy={loading}>
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
              <Button size="sm" variant="neutral" aria-disabled={!canNewer || loading} onClick={() => go(data.page - 1, canNewer)}>
                Newer
              </Button>
              <Button size="sm" variant="neutral" aria-disabled={!canOlder || loading} onClick={() => go(data.page + 1, canOlder)}>
                Older
              </Button>
            </span>
          </nav>
        )}
      </div>
    </Card>
  );
}
