// Starting the export: the blocked states, the typed matter-number confirmation, and the export job's progress.
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
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

/**
 * What an accept of changed counts was given for: everything the check showed then, the preview it compared
 * against and the sentences that say "before → now". A later check (Check again, a refetch after a refused start,
 * any job finishing, a new preview of the same version) that shows anything else needs a new accept. When the
 * counts weren't re-checked (null), the check itself, by when it ran, is what was accepted.
 */
function acceptKey(check: Schemas['ExportCheck'] | undefined): string | null {
  if (!check || check.blocked_code !== 'export_counts_changed') return null;
  return JSON.stringify([
    check.version,
    check.previewed_version,
    check.previewed_at,
    check.counts ?? check.checked_at,
    check.checks.map((item) => [item.key, item.status, item.message]),
  ]);
}

/** Whether focus went nowhere (a removed or disabled control) or stayed in this card, so moving it takes nothing away. */
function focusLostOrIn(section: HTMLElement | null): boolean {
  const active = document.activeElement;
  return !active || active === document.body || Boolean(section?.contains(active));
}

export function StartCard({ matterId, matterNumber, check, options, exportJob }: Props) {
  const headingId = useId();
  const fieldId = useId();
  const acceptId = useId();
  const mismatchId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [typed, setTyped] = useState('');
  // The check the counts were accepted for (acceptKey), not a plain yes: it lapses when the counts change.
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  // A finished or failed export stays on the card until the person sets up the next one.
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  const start = useStartExport(matterId);

  const data = check.data;
  const blocked = data?.blocked_code ?? null;
  const countsChanged = blocked === 'export_counts_changed';
  const currentKey = acceptKey(data);
  const accepted = countsChanged && currentKey !== null && acceptedFor === currentKey;
  const typedOk = Boolean(matterNumber) && typed.trim() === matterNumber;
  // Only a check that has answered, and isn't being asked again, can let an export start.
  const checkSettled = check.isSuccess && !check.isFetching && Boolean(data);
  const checksAllow = checkSettled && (data!.ready || accepted);
  const canStart = typedOk && checksAllow && !start.isPending;

  const shownJob = exportJob.jobId && exportJob.jobId !== dismissedJob ? exportJob : null;
  const shownId = shownJob?.jobId ?? null;

  // Whenever the card leaves the form or comes back to it (a start, a conflict that follows the running export,
  // one found running from another tab, a dismiss), the confirmation starts over: a typed matter number and an
  // accept are for one export, never the next. (Derived from the change while rendering, as src/api/jobs.ts does.)
  const [formFor, setFormFor] = useState<string | null>(shownId);
  if (formFor !== shownId) {
    setFormFor(shownId);
    setTyped('');
    setAcceptedFor(null);
  }

  // The element that had focus (the Start button, a dismiss button, the field) is gone after a switch: move focus
  // to what replaced it. Only when the person was working in this card, so a job found on opening the screen, or
  // started in another tab while they are elsewhere on the page, doesn't pull focus away.
  const focusInCard = useRef(false);
  const shownBefore = useRef(shownId);
  useEffect(() => {
    if (shownBefore.current === shownId) return;
    shownBefore.current = shownId;
    if (!focusInCard.current) return;
    if (!focusLostOrIn(sectionRef.current)) return;
    (shownId ? (statusRef.current ?? titleRef.current) : fieldRef.current)?.focus();
  }, [shownId]);

  const onStart = () => {
    if (!canStart) return;
    focusInCard.current = true;
    start.mutate(
      { confirm_matter_number: typed.trim(), accept_changes: accepted, options },
      {
        onSuccess: (job) => {
          setTyped('');
          setAcceptedFor(null);
          exportJob.track(job.id);
        },
        onError: (error) => {
          // The checks a real export ran found something the last check didn't: show it as the checks see it now.
          if (hasCode(error, 'export_not_previewed') || hasCode(error, 'export_counts_changed')) void check.refetch();
          // One is already running (another tab started it): follow that one instead, even one set aside here
          // earlier ("Set up the export again" after the server wouldn't say how it was doing).
          const running = error instanceof ApiRequestError && error.body.code === 'conflict' ? error.body.details?.job_id : undefined;
          if (typeof running === 'string') {
            setTyped('');
            setAcceptedFor(null);
            start.reset();
            setDismissedJob(null);
            exportJob.track(running);
            return; // the switch to that export moves focus
          }
          // Start was off while it was asked, so focus may have gone nowhere: to the field for a number it didn't
          // take, else to the card's heading, above what it says now.
          if (!focusLostOrIn(sectionRef.current)) return;
          if (hasCode(error, 'confirmation_mismatch')) fieldRef.current?.focus();
          else if (document.activeElement !== fieldRef.current) titleRef.current?.focus();
        },
      },
    );
  };

  const dismiss = (jobId: string | null) => {
    focusInCard.current = true;
    setTyped('');
    setAcceptedFor(null);
    start.reset();
    setDismissedJob(jobId);
  };
  const mismatch = hasCode(start.error, 'confirmation_mismatch') ? start.error : null;
  // A refused start that the refreshed checks now show as a blocked state needs saying only once.
  const shownByCheck = blocked !== null && hasCode(start.error, blocked);
  const otherError = start.error && !mismatch && !shownByCheck ? start.error : null;

  // The one live region of the card: the sentence that says the export started or finished, never the percentage.
  let statusLine: string | null = null;
  let phase: 'form' | 'error' | 'running' | 'succeeded' | 'failed' = 'form';
  let body;
  if (shownJob && !shownJob.isRunning && !shownJob.isSucceeded && !shownJob.isFailed && shownJob.queryError) {
    phase = 'error';
    // The server won't say how the export is doing (it answered no, so polling stopped): say so, and let the
    // person move on.
    body = (
      <>
        <ErrorNotice error={shownJob.queryError} matterId={matterId} headingLevel={3} />
        <p className={styles.muted}>The export may still be running in Purview: check the list of exports below or the log.</p>
        <Button size="sm" className={styles.selfStart} onClick={() => dismiss(shownJob.jobId)}>
          Set up the export again
        </Button>
      </>
    );
  } else if (shownJob && (shownJob.isRunning || !shownJob.job)) {
    phase = 'running';
    // Said once, when the job is known: not "Export started" and then again with its time.
    statusLine = shownJob.job ? `Export started at ${clock(shownJob.job.created_at)}` : null;
    body = (
      <>
        <Progress label="Export progress" value={shownJob.progress} />
        <p className={styles.muted}>Purview is preparing the package. Large exports can take a few hours; it appears below as Ready when it's done.</p>
        <ButtonLink to={`/matters/${encodeURIComponent(matterId)}/log`} size="sm" className={styles.selfStart}>
          See it in the log
        </ButtonLink>
      </>
    );
  } else if (shownJob?.isSucceeded) {
    phase = 'succeeded';
    statusLine = 'Export ready in Purview';
    body = (
      <>
        {shownJob.result && <p className="st-mono">{shownJob.result.name}</p>}
        <p className={styles.muted}>Hand it off to Everlaw as described alongside, or download it or send it to a review set.</p>
        <div className={styles.row}>
          <ButtonLink to={`/matters/${encodeURIComponent(matterId)}/log`} size="sm">
            See it in the log
          </ButtonLink>
          <Button size="sm" onClick={() => dismiss(shownJob.jobId)}>
            Set up another export
          </Button>
        </div>
      </>
    );
  } else if (shownJob?.isFailed) {
    phase = 'failed';
    body = (
      <>
        <ErrorNotice error={jobError(shownJob.failure)} matterId={matterId} headingLevel={3} />
        <Button size="sm" className={styles.selfStart} onClick={() => dismiss(shownJob.jobId)}>
          Set up the export again
        </Button>
      </>
    );
  } else {
    body = (
      <>
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
              <input
                id={acceptId}
                type="checkbox"
                checked={accepted}
                disabled={!checkSettled}
                onChange={(event) => setAcceptedFor(event.target.checked ? currentKey : null)}
              />
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
              ref={fieldRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
              value={typed}
              aria-invalid={mismatch ? true : undefined}
              aria-describedby={mismatch ? mismatchId : undefined}
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
        {mismatch && (
          <div id={mismatchId}>
            <InlineError>{(mismatch as ApiRequestError).message}</InlineError>
          </div>
        )}
        {otherError && <ErrorNotice error={otherError} matterId={matterId} headingLevel={3} />}
      </>
    );
  }

  // When a shown export fails, or the server stops saying how it is doing, the sentence that had focus is gone:
  // put focus on the card's heading, above the explanation. Again only for someone working in this card.
  const phaseBefore = useRef(phase);
  useEffect(() => {
    if (phaseBefore.current === phase) return;
    phaseBefore.current = phase;
    if ((phase !== 'failed' && phase !== 'error') || !focusInCard.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) titleRef.current?.focus();
  }, [phase]);

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className={styles.startCard}
      onFocus={() => {
        focusInCard.current = true;
      }}
      onBlur={(event) => {
        // Focus that moved to something else on the page; focus that went nowhere (a removed or disabled control) stays ours.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) focusInCard.current = false;
      }}
    >
      <h2 id={headingId} ref={titleRef} tabIndex={-1} className={styles.cardTitle}>
        Start the export
      </h2>
      <div className={styles.stack}>
        {/* Always mounted, so a change of its sentence is announced; empty, and out of the layout, until there is one. */}
        <div role="status" className={statusLine ? undefined : 'st-visually-hidden'}>
          {(phase === 'running' || phase === 'succeeded') && (
            <p ref={statusRef} tabIndex={-1} className={styles.done}>
              {statusLine && (
                <>
                  <CheckMark status="passed" />
                  {statusLine}
                </>
              )}
            </p>
          )}
        </div>
        {body}
      </div>
    </section>
  );
}
