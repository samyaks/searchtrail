// Starting the export: the blocked states, the typed matter-number confirmation, and the export job's progress.
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiRequestError, type Schemas } from '@/api/client';
import { hasCode } from '@/api/errors';
import type { useTrackedJob } from '@/api/jobs';
import { Banner, Button, ButtonLink, ErrorNotice, InlineError } from '@/components';
import styles from './ExportScreen.module.css';
import { clock } from './format';
import { useStartExport } from './hooks';
import { CheckMark } from './icons';
import { jobError } from './jobError';
import { Progress } from './Progress';

type ExportJob = ReturnType<typeof useTrackedJob<'export'>>;

type Props = {
  matterId: string;
  matterNumber: string | undefined;
  check: UseQueryResult<Schemas['ExportCheck']>;
  options: Schemas['ExportOptions'];
  exportJob: ExportJob;
};

export function StartCard({ matterId, matterNumber, check, options, exportJob }: Props) {
  const headingId = useId();
  const fieldId = useId();
  const acceptId = useId();
  const [typed, setTyped] = useState('');
  const [accepted, setAccepted] = useState(false);
  // A finished or failed export stays on the card until the person sets up the next one.
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  const start = useStartExport(matterId);

  const data = check.data;
  const blocked = data?.blocked_code ?? null;
  const countsChanged = blocked === 'export_counts_changed';
  const typedOk = Boolean(matterNumber) && typed.trim() === matterNumber;
  const checksAllow = Boolean(data) && (data!.ready || (countsChanged && accepted));
  const canStart = typedOk && checksAllow && !start.isPending;

  const onStart = () => {
    if (!canStart) return;
    start.mutate(
      { confirm_matter_number: typed.trim(), accept_changes: countsChanged && accepted, options },
      {
        onSuccess: (job) => {
          setTyped('');
          setAccepted(false);
          exportJob.track(job.id);
        },
        onError: (error) => {
          // The checks a real export ran found something the last check didn't: show it as the checks see it now.
          if (hasCode(error, 'export_not_previewed') || hasCode(error, 'export_counts_changed')) void check.refetch();
          // One is already running (another tab started it): follow that one instead.
          const running = error instanceof ApiRequestError && error.body.code === 'conflict' ? error.body.details?.job_id : undefined;
          if (typeof running === 'string') {
            start.reset();
            exportJob.track(running);
          }
        },
      },
    );
  };

  const shownJob = exportJob.jobId && exportJob.jobId !== dismissedJob ? exportJob : null;
  const mismatch = hasCode(start.error, 'confirmation_mismatch') ? start.error : null;
  // A refused start that the refreshed checks now show as a blocked state needs saying only once.
  const shownByCheck = blocked !== null && hasCode(start.error, blocked);
  const otherError = start.error && !mismatch && !shownByCheck ? start.error : null;

  let body;
  if (shownJob && (shownJob.isRunning || !shownJob.job)) {
    body = (
      <div role="status" className={styles.stack}>
        <p className={styles.done}>
          <CheckMark status="passed" />
          {shownJob.job ? `Export started at ${clock(shownJob.job.created_at)}` : 'Export started'}
        </p>
        <Progress label="Export progress" value={shownJob.progress} />
        <p className={styles.muted}>Purview is preparing the package. Large exports can take a few hours; it appears below as Ready when it's done.</p>
        <ButtonLink to={`/matters/${encodeURIComponent(matterId)}/log`} size="sm" className={styles.selfStart}>
          See it in the log
        </ButtonLink>
      </div>
    );
  } else if (shownJob?.isSucceeded) {
    body = (
      <div role="status" className={styles.stack}>
        <p className={styles.done}>
          <CheckMark status="passed" />
          Export ready in Purview
        </p>
        {shownJob.result && <p className="st-mono">{shownJob.result.name}</p>}
        <p className={styles.muted}>Hand it off to Everlaw as described alongside, or download it or send it to a review set.</p>
        <div className={styles.row}>
          <ButtonLink to={`/matters/${encodeURIComponent(matterId)}/log`} size="sm">
            See it in the log
          </ButtonLink>
          <Button size="sm" onClick={() => setDismissedJob(shownJob.jobId)}>
            Set up another export
          </Button>
        </div>
      </div>
    );
  } else if (shownJob?.isFailed) {
    body = (
      <div className={styles.stack}>
        <ErrorNotice error={jobError(shownJob.failure)} matterId={matterId} headingLevel={3} />
        <Button size="sm" className={styles.selfStart} onClick={() => setDismissedJob(shownJob.jobId)}>
          Set up the export again
        </Button>
      </div>
    );
  } else {
    body = (
      <div className={styles.stack}>
        <p className={styles.muted}>SearchTrail asks Purview to build the package. Nothing reaches Everlaw until someone imports it there.</p>
        {blocked === 'export_not_previewed' && (
          <Banner
            tone="warning"
            role="status"
            title="Export blocked: this query hasn't been previewed."
            actions={
              <ButtonLink to={`/matters/${encodeURIComponent(matterId)}/preview`} size="sm" variant="highlight">
                Go to Preview
              </ButtonLink>
            }
          >
            Preview this exact query and set of sources first, so the export matches what was reviewed.
          </Banner>
        )}
        {countsChanged && (
          <div className={styles.accept}>
            <Banner
              tone="warning"
              role="status"
              title="Export blocked: the counts changed since the preview."
              actions={
                <ButtonLink to={`/matters/${encodeURIComponent(matterId)}/preview`} size="sm">
                  Preview again
                </ButtonLink>
              }
            >
              New mail may have arrived. Preview again, or accept the new counts to export anyway.
            </Banner>
            <div className={styles.checkbox}>
              <input id={acceptId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <label htmlFor={acceptId}>
                <strong>Export with the new counts anyway.</strong> This choice is recorded in the log.
              </label>
            </div>
          </div>
        )}
        <div className={styles.confirm}>
          <div className={styles.field}>
            <label htmlFor={fieldId} className={styles.fieldLabel}>
              Type <span className="st-mono">{matterNumber ?? '…'}</span> to confirm
            </label>
            <input
              id={fieldId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
              value={typed}
              aria-invalid={mismatch ? true : undefined}
              onChange={(event) => {
                setTyped(event.target.value);
                if (start.isError) start.reset();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onStart();
              }}
            />
          </div>
          <Button variant="primary" disabled={!canStart} onClick={onStart}>
            {start.isPending ? 'Starting…' : 'Start export'}
          </Button>
        </div>
        {mismatch && <InlineError>{(mismatch as ApiRequestError).message}</InlineError>}
        {otherError && <ErrorNotice error={otherError} matterId={matterId} headingLevel={3} />}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className={styles.startCard}>
      <h2 id={headingId} className={styles.cardTitle}>
        Start the export
      </h2>
      {body}
    </section>
  );
}
