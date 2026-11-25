// Getting the package to the reviewers: the Everlaw steps from the design, and two more hand-offs (download the
// package into SearchTrail's storage, or add it to a Purview review set for Relativity), each a job with progress.
import { useEffect, useId, useState } from 'react';
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
/** How long the copy button says Copied. */
const COPIED_MS = 3000;

type HandoffJob = ReturnType<typeof useTrackedJob<'download'>> | ReturnType<typeof useTrackedJob<'review_set'>>;

type EverlawProps = {
  matter: Schemas['Matter'] | undefined;
  /** The existing export on screen (the one being started or followed, or opened in the list), if there is one. */
  exp: Export | undefined;
  /** Otherwise the steps are for the export Start would create: of this query version. */
  nextVersion: number | null;
};

export function EverlawCard({ matter, exp, nextVersion }: EverlawProps) {
  // What the copy button says after a copy, for the export it copied; it goes back to "Copy name" after a while.
  const [copiedState, setCopied] = useState<{ exportId: string; text: string } | null>(null);
  const copied = copiedState && copiedState.exportId === exp?.id ? copiedState.text : null;
  useEffect(() => {
    if (!copiedState) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedState]);
  const copy = (target: Export) => {
    const said = (text: string) => setCopied({ exportId: target.id, text });
    try {
      navigator.clipboard.writeText(target.name).then(
        () => said('Copied'),
        () => said('Select to copy'),
      );
    } catch {
      said('Select to copy');
    }
  };
  return (
    <Card title="Hand-off to Everlaw" padding="lg">
      <ol className={styles.steps}>
        <li>
          {exp ? (
            <>
              <span>SearchTrail {exp.status === 'ready' ? 'exported' : 'is exporting'} query v{exp.version} in Purview as</span>
              <span className={styles.nameRow}>
                <code className={styles.exportName}>{exp.name}</code>
                <Button size="sm" onClick={() => copy(exp)}>
                  {copied ?? 'Copy name'}
                </Button>
              </span>
            </>
          ) : (
            <>
              <span>SearchTrail starts the export{nextVersion !== null ? ` of query v${nextVersion}` : ''} in Purview as</span>
              <span className={styles.muted}> the matter number, EVERLAW and the time it starts. The name appears here once it has started.</span>
            </>
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

/** The hand-off job this card started, and the export it was started for. */
type StartedFor = { jobId: string; exportId: string } | null;

/**
 * Whether the job a hand-off follows belongs to the export shown: the one it was started for here, or the export
 * its result names. A job found running (on reopening the screen, or from another tab) carries no export, so the
 * export's own hand-off state says whether it is this one, and it has to be the same state: a failed job is this
 * export's only if its hand-off failed, and any other (running, or not saying how it is doing) only if its hand-off
 * is running. An earlier failure of this export's says nothing about another export's running hand-off.
 */
function jobIsFor(job: HandoffJob, startedFor: StartedFor, exp: Export | undefined, handoff: Schemas['HandoffStatus'] | undefined): boolean {
  if (!job.jobId || !exp) return false;
  if (startedFor?.jobId === job.jobId) return startedFor.exportId === exp.id;
  if (job.result) return job.result.id === exp.id;
  return job.isFailed ? handoff === 'failed' : handoff === 'running';
}

function JobState({ job, running, done, matterId }: { job: HandoffJob; running: string; done: (result: Export) => string; matterId: string }) {
  if (!job.jobId) return null;
  const finished = job.isSucceeded || job.isFailed;
  if (!job.isRunning && !finished && job.queryError) {
    // The server answered no when asked how the job is doing, so polling stopped: say so; the button below is free again.
    return <ErrorNotice error={job.queryError} matterId={matterId} headingLevel={3} />;
  }
  if (job.isRunning || !job.job) {
    return (
      <div className={styles.stack}>
        {/* The live region says that it started; the percentage stays out of it, so it isn't read out on every poll. */}
        <p role="status" className={styles.note}>
          {running}
        </p>
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
  const [startedFor, setStartedFor] = useState<StartedFor>(null);
  const ready = exp?.status === 'ready';
  const stored = exp?.download.status === 'done' ? exp.download : null;
  const ours = jobIsFor(job, startedFor, exp, exp?.download.status);
  // A refused start is about the export it was asked for.
  const startError = start.error && start.variables === exp?.id && !runningJobOf(start.error) ? start.error : null;
  return (
    <section aria-labelledby={headingId} className={styles.handoff}>
      <h3 id={headingId} className={styles.handoffTitle}>
        Download the package
      </h3>
      <p className={styles.note}>Copies the finished package from Purview into SearchTrail's storage, so it is kept after Purview deletes it.</p>
      {stored && !(ours && job.isRunning) && (
        <p className={styles.note}>
          Downloaded{stored.finished_at ? ` ${whenText(stored.finished_at)}` : ''} to <span className="st-mono">{stored.stored_path}</span>
        </p>
      )}
      {ours ? (
        <JobState
          job={job}
          matterId={matterId}
          running="Downloading the package from Purview"
          done={(result) => `Package downloaded to SearchTrail${result.download.stored_path ? `: ${result.download.stored_path}` : ''}`}
        />
      ) : (
        job.isRunning && exp && <p className={styles.note}>A download of another export is running. This one can start when it ends.</p>
      )}
      {startError && <ErrorNotice error={startError} matterId={matterId} headingLevel={3} />}
      <Button
        size="sm"
        className={styles.selfStart}
        disabled={!ready || job.isRunning || start.isPending}
        onClick={() =>
          exp &&
          start.mutate(exp.id, {
            onSuccess: (started) => {
              setStartedFor({ jobId: started.id, exportId: exp.id });
              job.track(started.id);
            },
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
  const problemId = useId();
  const start = useStartReviewSet(matterId);
  const [startedFor, setStartedFor] = useState<StartedFor>(null);
  // The name typed, and any problem with it, are for one export: choosing another starts from its suggested name.
  const [name, setName] = useState<{ exportId: string; value: string } | null>(null);
  const [problemState, setProblem] = useState<{ exportId: string; text: string } | null>(null);
  const suggested = exp ? `${matterNumber ?? ''} Relativity v${exp.version}`.trim() : '';
  const value = name && name.exportId === exp?.id ? name.value : suggested;
  const problem = problemState && problemState.exportId === exp?.id ? problemState.text : null;
  const ready = exp?.status === 'ready';
  const inSet = exp?.review_set.status === 'done' ? exp.review_set : null;
  const ours = jobIsFor(job, startedFor, exp, exp?.review_set.status);
  const startError = start.error && start.variables?.exportId === exp?.id && !runningJobOf(start.error) ? start.error : null;

  const send = () => {
    if (!exp) return;
    const trimmed = value.trim();
    if (!trimmed) return setProblem({ exportId: exp.id, text: 'Name the review set.' });
    if (trimmed.length > 200) return setProblem({ exportId: exp.id, text: 'Keep the name to 200 characters or fewer.' });
    setProblem(null);
    start.mutate(
      { exportId: exp.id, name: trimmed },
      {
        onSuccess: (started) => {
          setStartedFor({ jobId: started.id, exportId: exp.id });
          job.track(started.id);
        },
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
      {inSet && !(ours && job.isRunning) && (
        <p className={styles.note}>
          In review set <strong>{inSet.name}</strong>
          {inSet.finished_at ? ` since ${whenText(inSet.finished_at)}` : ''}
        </p>
      )}
      {ours ? (
        <JobState job={job} matterId={matterId} running="Adding the items to the review set" done={(result) => `Added to review set ${result.review_set.name ?? ''}`.trim()} />
      ) : (
        job.isRunning && exp && <p className={styles.note}>Another export is being added to a review set. This one can be sent when it ends.</p>
      )}
      {startError && <ErrorNotice error={startError} matterId={matterId} headingLevel={3} />}
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
            aria-describedby={problem ? problemId : undefined}
            onChange={(event) => {
              if (exp) setName({ exportId: exp.id, value: event.target.value });
              if (problem) setProblem(null);
            }}
          />
        </div>
        <Button size="sm" disabled={!ready || job.isRunning || start.isPending} onClick={send}>
          {start.isPending ? 'Starting…' : 'Send to review set'}
        </Button>
      </div>
      {problem && (
        <div id={problemId}>
          <InlineError>{problem}</InlineError>
        </div>
      )}
    </section>
  );
}
