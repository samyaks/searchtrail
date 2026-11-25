// The live summary: the right column of docs/design/Scope.dc.html (the estimate, the methodology and the KQL).
import { useState } from 'react';
import { ApiRequestError, type ApiError, type Schemas } from '@/api/client';
import { dayAndTime } from '@/app/time';
import { Banner, Button, ButtonLink, ErrorNotice, InlineError, MethodologyCard } from '@/components';
import { formatSize, plural } from './criteria';
import styles from './ScopeScreen.module.css';

export type ShownEstimate = { version: number; at: string; counts: Schemas['Counts'] };

type EstimateProps = {
  matter: Schemas['Matter'];
  /** The counts on screen: the latest estimate of the current query version, if there is one. */
  shown: ShownEstimate | null;
  /** The draft differs from the estimated query version (the API's `changed_since_version`). */
  changed: boolean;
  /** The version an estimate would make or estimate again ("Estimate v4"). */
  nextVersion: number;
  /** An estimate is starting or running. */
  busy: boolean;
  /** 0 to 1, while running. */
  progress: number | null;
  /** Why the estimate job failed. */
  failure: ApiError | null;
  /** Why starting it failed. */
  startError: unknown;
  /** What to do when Estimate was refused for invalid criteria (the message itself is shown under the field). */
  invalidNote: string | null;
  onEstimate: () => void;
};

export function EstimatePanel({ matter, shown, changed, nextVersion, busy, progress, failure, startError, invalidNote, onEstimate }: EstimateProps) {
  const previewed = Boolean(shown && !changed && matter.previewed_version === shown.version);
  const estimateButton = (
    <Button variant="primary" size="sm" onClick={onEstimate} disabled={busy}>
      Estimate v{nextVersion}
    </Button>
  );
  const pct = Math.round((progress ?? 0) * 100);
  return (
    <section aria-labelledby="est-h" className={styles.panel}>
      <div className={styles.estHead}>
        <h2 id="est-h" className={styles.h2}>
          Estimate
        </h2>
        {shown && (
          <span className={styles.muted13}>
            Estimated {dayAndTime(shown.at)} · v{shown.version}
          </span>
        )}
      </div>

      {busy && (
        <div className={styles.progressBox}>
          <p role="status" className={styles.progressText}>
            <strong>Estimating{progress !== null ? ` · ${pct}%` : '…'}</strong> Purview is counting the items. On a large matter this can take
            several minutes; you can leave this page and come back.
          </p>
          <div role="progressbar" aria-label="Estimate progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={styles.track}>
            <span className={styles.fill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {!busy && changed && shown && (
        <Banner title="You changed the query." actions={estimateButton}>
          These counts are still for v{shown.version}. Estimate again to see the effect.
        </Banner>
      )}

      {failure && <ErrorNotice error={new ApiRequestError(502, failure)} matterId={matter.id} onRetry={onEstimate} headingLevel={3} />}
      {startError !== null && startError !== undefined && <ErrorNotice error={startError} matterId={matter.id} onRetry={onEstimate} headingLevel={3} />}

      {invalidNote && <p className={styles.muted14}>{invalidNote}</p>}

      {!shown && !busy && (
        <div className={styles.stack10}>
          <p className={styles.muted14}>Not estimated yet. Estimate the query to ask Purview how many items match.</p>
          <div>{estimateButton}</div>
        </div>
      )}

      {shown && (
        <>
          <div className={styles.numbers} data-stale={changed || busy ? '' : undefined}>
            <p className={styles.bigLine}>
              <span className={styles.big}>{shown.counts.items.toLocaleString('en-US')}</span>
              <span className={styles.muted}>items match · {formatSize(shown.counts.size_bytes)}</span>
            </p>
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>Partially indexed</dt>
                <dd className={styles.factValue}>
                  {shown.counts.partial_items.toLocaleString('en-US')} · {formatSize(shown.counts.partial_size_bytes)}
                </dd>
                <dd className={styles.factNote}>Not keyword-searchable (encrypted, unsupported or oversized). Included in export.</dd>
              </div>
              <div className={styles.fact}>
                <dt>Locations</dt>
                <dd className={styles.factValue}>
                  {plural(shown.counts.mailboxes, 'mailbox', 'mailboxes')} · {plural(shown.counts.sites, 'site')}
                </dd>
              </div>
            </dl>
          </div>
          <div className={styles.row8}>
            <ButtonLink variant="primary" to={`/matters/${encodeURIComponent(matter.id)}/preview`}>
              {previewed ? 'Open preview' : 'Preview this query'}
            </ButtonLink>
            <ButtonLink to={`/matters/${encodeURIComponent(matter.id)}/terms`}>Test terms</ButtonLink>
          </div>
        </>
      )}
    </section>
  );
}

type MethodologyProps = {
  matterNumber: string;
  versionLabel: string;
  lines: readonly string[] | null;
  terms: readonly string[];
  /** Why there are no lines (the query can't be built yet), when there aren't. */
  unavailable: string | null;
};

export function MethodologyPanel({ matterNumber, versionLabel, lines, terms, unavailable }: MethodologyProps) {
  return (
    <section aria-labelledby="method-h" className={styles.stack8}>
      <h2 id="method-h" className={styles.h2}>
        Culling methodology
      </h2>
      {lines ? (
        <MethodologyCard lines={lines} terms={terms} heading={{ matter: matterNumber, version: versionLabel }} />
      ) : (
        <p className={`${styles.panel} ${styles.muted14}`}>{unavailable ?? 'Writing the methodology…'}</p>
      )}
      <p className={styles.hint}>Written from the filters on this page. Saved to the matter's log with every estimate, preview and export.</p>
    </section>
  );
}

type KqlProps = {
  preview: Schemas['KqlPreview'] | undefined;
  /** The API's criteria_invalid message, when it isn't about a field shown elsewhere. */
  problem: string | null;
  /** Where the problem is shown instead ("Search terms"). */
  problemAt: string | null;
  /** Any other error asking for the KQL. */
  error: unknown;
  onRetry: () => void;
};

export function KqlPanel({ preview, problem, problemAt, error, onRetry }: KqlProps) {
  // What Copy said, and for which query: once the query changes, the button offers to copy again.
  const [copiedNote, setCopiedNote] = useState<{ kql: string; note: string } | null>(null);
  const kql = preview?.kql ?? null;
  const copied = copiedNote && copiedNote.kql === kql ? copiedNote.note : null;
  const copy = () => {
    if (kql === null) return;
    try {
      navigator.clipboard.writeText(kql).then(
        () => setCopiedNote({ kql, note: 'Copied' }),
        () => setCopiedNote({ kql, note: 'Select the text to copy' }),
      );
    } catch {
      setCopiedNote({ kql, note: 'Select the text to copy' });
    }
  };
  return (
    <section aria-labelledby="kql-h" className={styles.panel} data-gap="sm">
      <div className={styles.panelHead}>
        <h2 id="kql-h" className={styles.h2}>
          Purview query (KQL)
        </h2>
        <Button variant="neutral" size="sm" onClick={copy} disabled={kql === null}>
          {copied ?? 'Copy KQL'}
        </Button>
      </div>
      {problem && <InlineError>{problem}</InlineError>}
      {problemAt && <p className={styles.muted14}>The query can't be built yet. See the message under {problemAt}.</p>}
      {error !== null && error !== undefined && <ErrorNotice error={error} onRetry={onRetry} headingLevel={3} />}
      {kql !== null && (
        <>
          <pre className={styles.kql}>
            {kql}
          </pre>
          <p className={styles.hint}>
            {(preview?.length ?? kql.length).toLocaleString('en-US')} characters. Each filter only touches the item types it applies to, so a domain
            filter never drops documents.
          </p>
        </>
      )}
      {preview?.warnings.map((w) => (
        <Banner key={w} tone="warning" role="status">
          {w}
        </Banner>
      ))}
    </section>
  );
}
