// The Terms screen: hits per search term, counted within every other filter (docs/design/Terms.dc.html).
// A term report is a job: starting one shows its progress, and opening the screen while one runs picks it up.
// Out of scope for V1 (docs/V1_PLAN.md): the unique-hits and "if removed" columns, "Try without" and its
// "What if" panel, and the Excel export.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, type ApiError } from '@/api/client';
import { useTrackedJob } from '@/api/jobs';
import { useMatter } from '@/api/queries';
import { Banner, Button, ButtonLink, EmptyState, ErrorNotice } from '@/components';
import { barPercent, changeHeader, changeText, countText, previousVersionOf, sizeText, whenText } from './format';
import { isNewerReport, runningJobOf, termReportKey, useLatestTermReport, useStartTermReport, type TermReport } from './hooks';
import styles from './TermsScreen.module.css';

/** What a failed count says when the job didn't say why. */
const JOB_FAILED: ApiError = { code: 'purview_operation_failed', message: '', details: {} };

export function TermsScreen() {
  const { matterId = '' } = useParams();
  // Keyed on the matter, so a count followed on one matter isn't carried over to the next matter's Terms.
  return <MatterTerms key={matterId} matterId={matterId} />;
}

function MatterTerms({ matterId }: { matterId: string }) {
  const matter = useMatter(matterId);
  const report = useLatestTermReport(matterId);
  const job = useTrackedJob(matterId, 'term_report');
  const start = useStartTermReport(matterId, job.track);

  const queryClient = useQueryClient();

  const counting = job.isRunning || start.isPending;
  const startCount = () => start.mutate();
  // A 409 that names the running job isn't a problem: the screen follows that job instead.
  const startError = start.isError && !runningJobOf(start.error) ? start.error : null;
  // Once a count is under way (one started elsewhere, say), an earlier refusal is old news: drop it, so it
  // doesn't hide what becomes of that count.
  const { reset: resetStart } = start;
  const refused = start.isError;
  useEffect(() => {
    if (job.isRunning && refused) resetStart();
  }, [job.isRunning, refused, resetStart]);
  // The followed job is kept when the person moves to another matter's Terms, so only use what it ended with here.
  const onThisMatter = job.job?.matter_id === matterId;
  // The last job's failure, unless something newer replaced it: a count under way, or a start that was refused.
  // (A 409 that handed over the running job isn't a refusal: if that job fails, say so.)
  const jobFailure = job.isFailed && onThisMatter && !counting && !startError ? (job.failure ?? JOB_FAILED) : null;

  // A finished count carries its report, so show it at once instead of the old one until the refetch lands.
  const fresh = job.isSucceeded && onThisMatter ? job.result : null;
  const shown = fresh && (!report.data || isNewerReport(fresh, report.data)) ? fresh : (report.data ?? null);
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (fresh && seeded.current !== fresh.id) {
      seeded.current = fresh.id;
      const cached = queryClient.getQueryData<TermReport | null>(termReportKey(matterId));
      if (!cached || isNewerReport(fresh, cached)) queryClient.setQueryData(termReportKey(matterId), fresh);
    }
  }, [fresh, matterId, queryClient]);

  return (
    <section aria-labelledby="terms-title" className={styles.screen}>
      <h2 id="terms-title" className="st-visually-hidden">
        Terms
      </h2>

      {shown && (
        <div className={styles.toolbar}>
          <p className={styles.intro}>
            Counted {whenText(shown.created_at)} for query v{shown.version}. Each term is counted inside every other filter: the same custodians, dates,
            item types and labels. Counting runs on a separate search, so the search you previewed is never changed.
          </p>
          {/* While the count is out of date, the banner below has the one Recount. */}
          {!(shown.stale && !counting) && (
            <div className={styles.actions}>
              <Button variant="neutral" onClick={startCount} disabled={counting}>
                Recount
              </Button>
            </div>
          )}
        </div>
      )}

      {/* While a new start is on its way the tracked job may still be the last, finished one: don't show its 100%. */}
      <Progress counting={counting} progress={job.isRunning ? job.progress : 0} queued={!job.isRunning || !job.job || job.job.status === 'queued'} />

      {jobFailure && <ErrorNotice error={new ApiRequestError(502, jobFailure)} matterId={matterId} onRetry={startCount} headingLevel={3} />}

      {startError && <ErrorNotice error={startError} matterId={matterId} onRetry={startCount} headingLevel={3} />}

      {shown?.stale && !counting && (
        <Banner
          title="The query has changed since this count."
          actions={
            <Button variant="neutral" onClick={startCount}>
              Recount
            </Button>
          }
        >
          These hits are for query v{shown.version}. The search terms or filters are different now, so choose Recount to count them again.
        </Banner>
      )}

      {report.isPending && (
        <p className={styles.loading} aria-busy="true">
          Loading the term report…
        </p>
      )}

      {report.isError && <ErrorNotice error={report.error} matterId={matterId} onRetry={() => void report.refetch()} headingLevel={3} />}

      {shown && <ReportTable report={shown} />}

      {/* Which empty state depends on the matter (is there a query yet?), so wait for it. */}
      {!shown && report.data === null && !counting && matter.data && (
        <div className={styles.emptyPanel}>
          {matter.data.current_version === null ? (
            <EmptyState
              title="No term report yet"
              action={
                <ButtonLink variant="primary" to={`/matters/${encodeURIComponent(matterId)}/scope`}>
                  Go to Scope
                </ButtonLink>
              }
            >
              Terms are counted within the query, so estimate it in Scope first. Then come back to see how many items each search term finds.
            </EmptyState>
          ) : (
            <EmptyState
              title="No term report yet"
              action={
                <Button variant="primary" onClick={startCount}>
                  Count hits per term
                </Button>
              }
            >
              See how many items each search term finds within every other filter: the same custodians, dates, item types and labels. Counting runs on a
              separate search, so the search you previewed is never changed.
            </EmptyState>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A running count: how far along it is. It carries on if the person leaves the screen. The block stays in the
 * page, hidden, while nothing is counting, so its live region is already there when the first text goes in and
 * that is read out. Only the phase is live: the percent is left to the progress bar, not read out on every poll.
 */
function Progress({ counting, progress, queued }: { counting: boolean; progress: number; queued: boolean }) {
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The button that started the count is gone (the stale banner's, the empty state's, Try again): rather than
    // leave focus on the page itself, bring it here. Focus that is still somewhere is left alone.
    const active = document.activeElement;
    if (counting && (active === null || active === document.body)) block.current?.focus();
  }, [counting]);
  const percent = Math.round(progress * 100);
  return (
    <div ref={block} className={counting ? styles.progress : 'st-visually-hidden'} tabIndex={counting ? -1 : undefined}>
      <div className={styles.progressTitle}>
        <p className={styles.phase} role="status">
          {counting && <strong>{queued ? 'Starting the count…' : 'Counting hits per term…'}</strong>}
        </p>
        {counting && <span className={styles.percent}>{percent}%</span>}
      </div>
      {counting && (
        <>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Counting hits per term"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
          <p className={styles.progressNote}>
            Purview counts each term on a separate search, which can take a few minutes. You can leave this screen: the count carries on and shows
            here when it's done.
          </p>
        </>
      )}
    </div>
  );
}

function ReportTable({ report }: { report: TermReport }) {
  const combined = report.combined.items;
  const previousVersion = previousVersionOf(report.rows);
  return (
    <section aria-labelledby="report-title" className={styles.report}>
      <div className={styles.reportHeader}>
        <h3 id="report-title" className={styles.reportTitle}>
          Search term report
        </h3>
        <span className={styles.reportNote}>Hits are the items each term finds. An item that matches more than one term is counted under each.</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table} data-stale={report.stale || undefined}>
          <caption className="st-visually-hidden">Search term report, query v{report.version}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.termCol}>
                Term
              </th>
              <th scope="col">Hits within scope</th>
              <th scope="col" className={`${styles.numeric} ${styles.changeCol}`}>
                {changeHeader(report.rows)}
              </th>
              <th scope="col" className={`${styles.numeric} ${styles.sizeCol}`}>
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.none}>
                  This query has no search terms to count.
                </td>
              </tr>
            )}
            {report.rows.map((row, index) => (
              <tr key={`${index}:${row.term}`}>
                <th scope="row" className={styles.term}>
                  {row.term}
                </th>
                <td>
                  <HitsBar items={row.items} percent={barPercent(row.items, combined)} />
                </td>
                <td className={`${styles.numeric} ${styles.muted}`}>{changeText(row, report.version, previousVersion)}</td>
                <td className={`${styles.numeric} ${styles.muted}`}>{sizeText(row.size_bytes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All terms combined</th>
              <td>
                <HitsBar items={combined} percent={combined > 0 ? 100 : 0} total />
              </td>
              <td className={styles.numeric} />
              <td className={styles.numeric}>{sizeText(report.combined.size_bytes)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function HitsBar({ items, percent, total = false }: { items: number; percent: number; total?: boolean }) {
  return (
    <span className={styles.hits}>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} data-total={total || undefined} style={{ width: `${percent}%` }} />
      </span>
      <span className={styles.count}>{countText(items)}</span>
    </span>
  );
}
