// Log (docs/design/Log.dc.html): how the set narrowed across query versions, the hash-chained log with its
// check, and what changed between two versions.
import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { useMatter } from '@/api/queries';
import { ErrorNotice } from '@/components';
import { CompareVersions } from './CompareVersions';
import { Entries } from './Entries';
import { LOG_PAGE_SIZE, useLogPage, useVerification, useVersions } from './hooks';
import styles from './LogScreen.module.css';
import { Narrowing } from './Narrowing';
import { methodologyReport, saveText } from './report';
import { VerifyBar } from './VerifyBar';

export function LogScreen() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);
  const versions = useVersions(matterId);
  const verification = useVerification(matterId);
  const [page, setPage] = useState(1);
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const focused = useCallback(() => setFocusSeq(null), []);
  const log = useLogPage(matterId, page);

  const verified = verification.data;
  const badSeq = verified && !verified.ok ? verified.first_bad_seq : null;
  // On page 1 the newest entry is the chain's head, which the report records.
  const head = log.data?.page === 1 ? log.data.items[0] : undefined;

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
    const total = log.data?.total ?? seq;
    setPage(Math.max(1, Math.ceil((total - seq + 1) / LOG_PAGE_SIZE)));
    setFocusSeq(seq);
  };

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
            data={log.data}
            loading={log.isFetching}
            error={log.isError ? log.error : null}
            onRetry={() => void log.refetch()}
            onPage={setPage}
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
