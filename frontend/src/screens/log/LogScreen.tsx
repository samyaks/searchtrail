// Log (docs/design/Log.dc.html): how the set narrowed across query versions, the hash-chained log with its
// check, and what changed between two versions.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Schemas } from '@/api/client';
import { useParams } from 'react-router';
import { useMatter } from '@/api/queries';
import { ErrorNotice } from '@/components';
import { CompareVersions } from './CompareVersions';
import { Entries } from './Entries';
import { LOG_PAGE_SIZE, logKeys, useLogHead, useLogPage, useVerification, useVersions } from './hooks';
import styles from './LogScreen.module.css';
import { Narrowing } from './Narrowing';
import { methodologyReport, saveText } from './report';
import { VerifyBar } from './VerifyBar';

export function LogScreen() {
  const { matterId = '' } = useParams();
  const client = useQueryClient();
  const matter = useMatter(matterId);
  const versions = useVersions(matterId);
  const verification = useVerification(matterId);
  const [page, setPage] = useState(1);
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const focused = useCallback(() => setFocusSeq(null), []);
  const log = useLogPage(matterId, page);
  // The chain's head (the newest entry), which the report records, whichever page is shown: null when nothing is
  // logged yet, undefined while it is read or when it can't be (the report then says it wasn't read).
  const headQuery = useLogHead(matterId);
  const head = headQuery.data ?? (headQuery.isSuccess ? null : undefined);

  // The last page read, kept on screen (with its pager) when the next one, or a fresh read of it, fails.
  const [lastGood, setLastGood] = useState<{ matterId: string; data: Schemas['LogEntryPage'] } | null>(null);
  if (log.data && !log.isPlaceholderData && log.data !== lastGood?.data) setLastGood({ matterId, data: log.data });
  // It is read from the cache, so a fresh read of that page (page 1 is kept fresh for the head, and is read again when
  // a job ends) shows even while the page asked for keeps failing.
  const fallback =
    lastGood?.matterId === matterId
      ? (client.getQueryData<Schemas['LogEntryPage']>(logKeys.log(matterId, lastGood.data.page)) ?? lastGood.data)
      : undefined;
  const shown = log.data ?? fallback;

  // An entry asked for ("Show entry 5") that isn't on the page it should be on is let go, so it can't take focus later.
  // (Setting state while rendering, guarded like this, is React's way to derive state from a change.)
  const settled = log.data && !log.isPlaceholderData && !log.isFetching ? log.data : undefined;
  if (focusSeq !== null && settled && !settled.items.some((entry) => entry.seq === focusSeq)) setFocusSeq(null);

  const verified = verification.data;
  const badSeq = verified && !verified.ok ? verified.first_bad_seq : null;

  const report =
    matter.data && versions.data
      ? () => {
          const m = matter.data!;
          const latest = versions.data!.at(-1);
          const text = methodologyReport({ matter: m, versions: versions.data!, verification: verified, head });
          saveText(`${m.matter_number} methodology${latest ? ` v${latest.version}` : ''}.txt`, text);
        }
      : undefined;

  /** Open the page that holds entry `seq` (newest first) and bring the entry into view. */
  const showEntry = (seq: number) => {
    const total = shown?.total ?? seq;
    const pageSize = shown?.page_size || LOG_PAGE_SIZE;
    const target = Math.max(1, Math.ceil((total - seq + 1) / pageSize));
    // The page asked for already, and failed (an older page is shown): read it again, or nothing would happen.
    if (target === page && log.isError) void log.refetch();
    else setPage(target);
    setFocusSeq(seq);
  };

  /** Show a page; asking for the one already asked for (an older page is shown because it failed) reads it again. */
  const goTo = (next: number) => (next === page ? void log.refetch() : setPage(next));

  return (
    <div className={styles.screen}>
      {/* Every matter screen names itself (the tab's label) for screen readers; the design shows the tab instead. */}
      <h2 className="st-visually-hidden">Log</h2>
      <VerifyBar
        matterId={matterId}
        verification={verified}
        checking={verification.isFetching}
        error={verification.isError ? verification.error : null}
        onVerify={() => void verification.refetch()}
        onReport={report}
        onShowBad={showEntry}
      />

      {versions.isError ? (
        <ErrorNotice error={versions.error} matterId={matterId} onRetry={() => void versions.refetch()} />
      ) : versions.data ? (
        <Narrowing versions={versions.data} />
      ) : (
        <p className={styles.muted}>Loading the query versions…</p>
      )}

      <div className={styles.columns}>
        <div className={styles.entriesColumn}>
          <Entries
            matterId={matterId}
            data={shown}
            page={page}
            loading={log.isFetching}
            error={log.isError ? log.error : null}
            onRetry={() => void log.refetch()}
            onPage={goTo}
            badSeq={badSeq}
            focusSeq={focusSeq}
            onFocused={focused}
          />
        </div>
        <div className={styles.compareColumn}>
          {versions.data && <CompareVersions matterId={matterId} versions={versions.data} />}
        </div>
      </div>
    </div>
  );
}
