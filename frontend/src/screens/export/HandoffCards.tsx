// Getting the package to the reviewers: the Everlaw steps from the design, and two more hand-offs (download the
// package into SearchTrail's storage, or add it to a Purview review set for Relativity), each a job with progress.
import { useId, useState } from 'react';
import { ApiRequestError, type Schemas } from '@/api/client';
import type { useTrackedJob } from '@/api/jobs';
import { Button, Card, ErrorNotice, InlineError } from '@/components';
import styles from './ExportScreen.module.css';
import { longDate, whenText } from './format';
import { useStartDownload, useStartReviewSet } from './hooks';
import { CheckMark } from './icons';
import { jobError } from './jobError';
import { Progress } from './Progress';

type Export = Schemas['Export'];
type HandoffJob = ReturnType<typeof useTrackedJob<'download'>> | ReturnType<typeof useTrackedJob<'review_set'>>;

export function EverlawCard({ matter, exp }: { matter: Schemas['Matter'] | undefined; exp: Export | undefined }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (name: string) => {
    try {
      navigator.clipboard.writeText(name).then(
        () => setCopied('Copied'),
        () => setCopied('Select to copy'),
      );
    } catch {
      setCopied('Select to copy');
    }
  };
  return (
    <Card title="Hand-off to Everlaw" padding="lg">
      <ol className={styles.steps}>
        <li>
          <span>SearchTrail starts the export in Purview as</span>
          {exp ? (
            <span className={styles.nameRow}>
              <code className={styles.exportName}>{exp.name}</code>
              <Button size="sm" onClick={() => copy(exp.name)}>
                {copied ?? 'Copy name'}
              </Button>
            </span>
          ) : (
            <span className={styles.muted}> the matter number, EVERLAW and the time it starts. The name appears here once it has started.</span>
          )}
        </li>
        <li>
          In Everlaw, open the project's <strong>Purview Cloud Connector</strong>.
        </li>
        <li>
          Choose the case{' '}
          <strong>
            {matter ? `${matter.matter_number} ${matter.name}` : 'for this matter'}
          </strong>{' '}
          and the export above.
        </li>
        <li>
          {exp?.expires_at ? (
            <>
              Import by <strong>{longDate(exp.expires_at)}</strong>. Purview keeps export downloads for about 30 days.
            </>
          ) : (
            'Import within about 30 days of the export being ready: Purview keeps export downloads for that long.'
          )}
        </li>
      </ol>
    </Card>
  );
}

type OtherProps = {
  matterId: string;
  matterNumber: string | undefined;
  /** The export to hand off: the one chosen in the history, or the newest that is ready. */
  exp: Export | undefined;
  downloadJob: ReturnType<typeof useTrackedJob<'download'>>;
  reviewSetJob: ReturnType<typeof useTrackedJob<'review_set'>>;
};

export function OtherHandoffsCard({ matterId, matterNumber, exp, downloadJob, reviewSetJob }: OtherProps) {
  return (
    <Card title="Other ways to hand off" padding="lg">
      {exp ? (
        <p className={styles.note}>
          For <span className="st-mono">{exp.name}</span> (query v{exp.version}). Choose another export in the list below.
        </p>
      ) : (
        <p className={styles.muted}>These open once an export is ready in Purview.</p>
      )}
      <DownloadHandoff matterId={matterId} exp={exp} job={downloadJob} />
      <ReviewSetHandoff matterId={matterId} matterNumber={matterNumber} exp={exp} job={reviewSetJob} />
    </Card>
  );
}

/** A refused start that says which job is already running: follow that one. */
function runningJobOf(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError) || error.body.code !== 'conflict') return undefined;
  const id = error.body.details?.job_id;
  return typeof id === 'string' ? id : undefined;
}

function JobState({ job, running, done, matterId }: { job: HandoffJob; running: string; done: (result: Export) => string; matterId: string }) {
  if (!job.jobId) return null;
  if (job.isRunning || !job.job) {
    return (
      <div role="status" className={styles.stack}>
        <p className={styles.note}>{running}</p>
        <Progress label={running} value={job.progress} />
      </div>
    );
  }
  if (job.isFailed) return <ErrorNotice error={jobError(job.failure)} matterId={matterId} headingLevel={3} />;
  if (job.result) {
    return (
      <p role="status" className={styles.done}>
        <CheckMark status="passed" />
        {done(job.result)}
      </p>
    );
  }
  return null;
}

function DownloadHandoff({ matterId, exp, job }: { matterId: string; exp: Export | undefined; job: OtherProps['downloadJob'] }) {
  const headingId = useId();
  const start = useStartDownload(matterId);
  const ready = exp?.status === 'ready';
  const stored = exp?.download.status === 'done' ? exp.download : null;
  return (
    <section aria-labelledby={headingId} className={styles.handoff}>
      <h3 id={headingId} className={styles.handoffTitle}>
        Download the package
      </h3>
      <p className={styles.note}>Copies the finished package from Purview into SearchTrail's storage, so it is kept after Purview deletes it.</p>
      {stored && !job.isRunning && (
        <p className={styles.note}>
          Downloaded{stored.finished_at ? ` ${whenText(stored.finished_at)}` : ''} to <span className="st-mono">{stored.stored_path}</span>
        </p>
      )}
      <JobState
        job={job}
        matterId={matterId}
        running="Downloading the package from Purview"
        done={(result) => `Package downloaded to SearchTrail${result.download.stored_path ? `: ${result.download.stored_path}` : ''}`}
      />
      {start.error && !runningJobOf(start.error) && <ErrorNotice error={start.error} matterId={matterId} headingLevel={3} />}
      <Button
        size="sm"
        className={styles.selfStart}
        disabled={!ready || job.isRunning || start.isPending}
        onClick={() =>
          exp &&
          start.mutate(exp.id, {
            onSuccess: (started) => job.track(started.id),
            onError: (error) => {
              const running = runningJobOf(error);
              if (running) job.track(running);
            },
          })
        }
      >
        {start.isPending ? 'Starting…' : stored ? 'Download again' : 'Download the package'}
      </Button>
    </section>
  );
}

function ReviewSetHandoff({ matterId, matterNumber, exp, job }: { matterId: string; matterNumber: string | undefined; exp: Export | undefined; job: OtherProps['reviewSetJob'] }) {
  const headingId = useId();
  const fieldId = useId();
  const start = useStartReviewSet(matterId);
  const [name, setName] = useState<string | null>(null);
  const suggested = exp ? `${matterNumber ?? ''} Relativity v${exp.version}`.trim() : '';
  const value = name ?? suggested;
  const [problem, setProblem] = useState<string | null>(null);
  const ready = exp?.status === 'ready';
  const inSet = exp?.review_set.status === 'done' ? exp.review_set : null;

  const send = () => {
    if (!exp) return;
    const trimmed = value.trim();
    if (!trimmed) return setProblem('Name the review set.');
    if (trimmed.length > 200) return setProblem('Keep the name to 200 characters or fewer.');
    setProblem(null);
    start.mutate(
      { exportId: exp.id, name: trimmed },
      {
        onSuccess: (started) => job.track(started.id),
        onError: (error) => {
          const running = runningJobOf(error);
          if (running) job.track(running);
        },
      },
    );
  };

  return (
    <section aria-labelledby={headingId} className={styles.handoff}>
      <h3 id={headingId} className={styles.handoffTitle}>
        Send to a Purview review set (for Relativity)
      </h3>
      <p className={styles.note}>Adds this export's items to a review set in the Purview case, where Relativity's Purview Sync picks them up.</p>
      {inSet && !job.isRunning && (
        <p className={styles.note}>
          In review set <strong>{inSet.name}</strong>
          {inSet.finished_at ? ` since ${whenText(inSet.finished_at)}` : ''}
        </p>
      )}
      <JobState job={job} matterId={matterId} running="Adding the items to the review set" done={(result) => `Added to review set ${result.review_set.name ?? ''}`.trim()} />
      {start.error && !runningJobOf(start.error) && <ErrorNotice error={start.error} matterId={matterId} headingLevel={3} />}
      <div className={styles.confirm}>
        <div className={styles.field}>
          <label htmlFor={fieldId} className={styles.fieldLabel}>
            Review set name
          </label>
          <input
            id={fieldId}
            type="text"
            autoComplete="off"
            className={styles.input}
            value={value}
            disabled={!ready}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (problem) setProblem(null);
            }}
          />
        </div>
        <Button size="sm" disabled={!ready || job.isRunning || start.isPending} onClick={send}>
          {start.isPending ? 'Starting…' : 'Send to review set'}
        </Button>
      </div>
      {problem && <InlineError>{problem}</InlineError>}
    </section>
  );
}
