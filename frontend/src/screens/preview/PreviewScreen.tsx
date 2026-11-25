// Preview (docs/design/Preview.dc.html): what the current query finds, from Purview's item report. Start or
// refresh a preview (a job), see its counts and breakdowns, filter the item table by a bar, page through it and
// download the whole list. A preview that no longer matches the query says so.
import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, type Schemas } from '@/api/client';
import { hasCode } from '@/api/errors';
import { useMatter } from '@/api/queries';
import { Banner, BarBreakdown, Button, ButtonLink, CountTile, EmptyState, ErrorNotice, MonthChart, TileGrid } from '@/components';
import { barKey, madeWhen, monthSpan, pointToButton, sizeText, type BarFilter, type Dimension } from './format';
import { useDownloadCsv, useLatestPreview, usePreviewJob } from './hooks';
import { ItemTable } from './ItemTable';
import { JobProgress } from './JobProgress';
import styles from './PreviewScreen.module.css';

type Preview = Schemas['Preview'];
type Matter = Schemas['Matter'];

export function PreviewScreen() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);
  const latest = useLatestPreview(matterId);
  const job = usePreviewJob(matterId);
  const version = matter.data?.current_version ?? null;
  const busy = job.isRunning || job.isStarting;
  // One button to start a preview at a time. The preview shown, or the "nothing previewed yet" card, always has one,
  // named for what it does ("Preview query v4"): a failure notice offers its own "Try again" only when they don't.
  const pageStarts = Boolean(matter.data) && (Boolean(latest.data) || (latest.data === null && version !== null && !job.isRunning));
  const retry = pageStarts ? undefined : job.start;
  // A failure's message ends "…then try again"; when the button for that is the page's own, it says that button's name.
  const failure = job.failure ?? { code: 'purview_operation_failed' as const, message: '', details: {} };
  const label = pageStarts && matter.data ? pageStartLabel(matter.data, latest.data ?? null) : null;
  const failed = new ApiRequestError(502, label ? { ...failure, message: pointToButton(failure.message, label) } : failure);

  return (
    <div className={styles.screen}>
      <h2 className="st-visually-hidden">Preview</h2>

      {job.isRunning && <JobProgress progress={job.progress} version={version} />}
      {job.isFailed && (
        <ErrorNotice error={failed} matterId={matterId} onRetry={retry} />
      )}
      {job.startError !== null && <ErrorNotice error={job.startError} matterId={matterId} onRetry={retry} />}
      {/* Asking about the job was refused (the session ended, the job is gone): say so rather than go quiet. A job that
          already ended has said what it had to: a later failed refetch of it isn't news. */}
      {job.queryError !== null && !job.isRunning && !job.isSucceeded && !job.isFailed && (
        <JobQueryError error={job.queryError} matterId={matterId} onRetry={() => void job.refetch()}
          // Not while the page is still loading: it may well offer its own button in a moment.
          onStart={latest.isPending || matter.isPending ? undefined : retry}
          busy={busy}
        />
      )}

      {(latest.isPending || (latest.isSuccess && matter.isPending)) && <p className={styles.muted}>Loading the preview…</p>}
      {latest.isError && <ErrorNotice error={latest.error} matterId={matterId} onRetry={() => void latest.refetch()} />}
      {/* Wait for the matter too: without it, "no query yet" can't be told from "not loaded yet". */}
      {latest.data === null && matter.data && !job.isRunning && <NothingPreviewed matterId={matterId} version={version} onStart={job.start} busy={busy} />}
      {latest.data && matter.data && (
        // Keyed by the preview, so a new preview starts with no filter, on page 1.
        <PreviewBody key={latest.data.id} preview={latest.data} matter={matter.data} onRefresh={job.start} busy={busy} />
      )}
    </div>
  );
}

/** The name of the button the page itself offers to start a preview (in the banner, the toolbar or the empty card). */
function pageStartLabel(matter: Matter, preview: Preview | null): string {
  const current = matter.current_version;
  if (!preview || (current !== null && current !== preview.version)) return `Preview query v${current ?? ''}`;
  return preview.stale && !matter.draft_changed ? 'Preview again' : 'Refresh preview';
}

/**
 * Why the screen can't follow the job. A job that can't be found (it ended and was cleared away, say) gets its own
 * words: the shared "not found" notice sends the person back to Matters, away from a screen that still works. It
 * offers to preview again only when the page doesn't already (one button to start a preview at a time).
 */
function JobQueryError({ error, matterId, onRetry, onStart, busy }: { error: unknown; matterId: string; onRetry: () => void; onStart?: () => void; busy: boolean }) {
  if (!hasCode(error, 'not_found')) return <ErrorNotice error={error} matterId={matterId} onRetry={onRetry} />;
  const message = error instanceof ApiRequestError ? error.body.message?.trim() : '';
  return (
    <Banner
      role="alert"
      title="We can't find the preview job."
      actions={
        onStart && (
          <Button size="sm" variant="highlight" onClick={onStart} disabled={busy}>
            Preview again
          </Button>
        )
      }
    >
      {message || 'It may have ended and been cleared away.'}
    </Banner>
  );
}

function NothingPreviewed({ matterId, version, onStart, busy }: { matterId: string; version: number | null; onStart: () => void; busy: boolean }) {
  if (version === null) {
    return (
      <EmptyState title="Nothing previewed yet" action={<ButtonLink to={`/matters/${encodeURIComponent(matterId)}/scope`}>Go to Scope</ButtonLink>}>
        Build and estimate a query on Scope first. A preview lists what that query finds.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      title="Nothing previewed yet"
      action={
        <Button variant="primary" onClick={onStart} disabled={busy}>
          Preview query v{version}
        </Button>
      }
    >
      A preview builds Purview's item report for query v{version}: counts, breakdowns and a list of the items. It lists metadata only;
      document contents stay in Purview until export.
    </EmptyState>
  );
}

const DownloadIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
  </svg>
);

const n = (value: number) => value.toLocaleString('en-US');

function PreviewBody({ preview, matter, onRefresh, busy }: { preview: Preview; matter: Matter; onRefresh: () => void; busy: boolean }) {
  const [filter, setFilter] = useState<BarFilter | null>(null);
  const [page, setPage] = useState(1);
  const download = useDownloadCsv(preview.id);
  const { counts, breakdowns } = preview;
  const partialIncluded = counts.partial_items > 0 && preview.report_items > counts.items;

  const choose = (dimension: Dimension, buckets: Schemas['NamedCount'][]) => (key: string | null) => {
    const bucket = key === null ? undefined : buckets.find((b) => barKey(dimension, b.name) === key);
    setFilter(bucket ? { dimension, name: bucket.name, count: bucket.count } : null);
    setPage(1);
  };
  const bars = (dimension: Dimension, buckets: Schemas['NamedCount'][]) =>
    buckets.map((b) => ({ key: barKey(dimension, b.name), label: b.name, count: b.count, quiet: dimension === 'label' && b.name === 'No label' }));
  const selectedKey = filter ? barKey(filter.dimension, filter.name) : null;
  // One button to start a preview at a time: when the banner offers one, it is the only one. Otherwise the toolbar's
  // says what it does: the same query again, or the newer query version that a new preview would be of.
  const current = matter.current_version;
  const bannerStarts = !matter.draft_changed && ((current !== null && current !== preview.version) || preview.stale);
  const startLabel = current !== null && current !== preview.version ? `Preview query v${current}` : 'Refresh preview';

  return (
    <>
      <StaleBanner preview={preview} matter={matter} onRefresh={onRefresh} busy={busy} />

      <div className={styles.intro}>
        <p className={styles.source}>
          Built from Purview's item report for search{' '}
          <span className={styles.mono}>
            {matter.matter_number} cull v{preview.version}
          </span>{' '}
          {madeWhen(preview.created_at)}. It lists metadata only; document contents stay in Purview until export.
        </p>
        <div className={styles.actions}>
          {!bannerStarts && (
            <Button onClick={onRefresh} disabled={busy}>
              {startLabel}
            </Button>
          )}
          <Button icon={<DownloadIcon />} aria-disabled={download.isPending} onClick={download.isPending ? undefined : () => download.mutate()}>
            {download.isPending ? 'Downloading…' : 'Download preview.csv'}
          </Button>
        </div>
      </div>
      {download.isError && <ErrorNotice error={download.error} matterId={matter.id} onRetry={() => download.mutate()} />}

      <TileGrid>
        <CountTile label="Items matching" value={counts.items} note={sizeText(counts.size_bytes)} />
        <CountTile
          label="Partially indexed"
          value={counts.partial_items}
          note={`${sizeText(counts.partial_size_bytes)} · ${partialIncluded ? 'included in this preview' : 'not in this preview'}`}
          noteTone={partialIncluded ? 'ok' : 'muted'}
        />
        <CountTile label="Encrypted" value={preview.encrypted_items} note="Reviewers may not be able to open these" />
        <CountTile
          label="Locations"
          value={counts.mailboxes + counts.sites}
          note={`${n(counts.mailboxes)} ${counts.mailboxes === 1 ? 'mailbox' : 'mailboxes'}, ${n(counts.sites)} OneDrive and SharePoint ${counts.sites === 1 ? 'site' : 'sites'}`}
        />
      </TileGrid>

      <section aria-labelledby="preview-breakdowns" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="preview-breakdowns" className={styles.h2}>
            What's in the {n(preview.report_items)} items
          </h2>
          <span className={styles.muted}>
            {partialIncluded && `Includes the ${n(counts.partial_items)} partially indexed items. `}Choose a bar to filter the item list.
          </span>
        </div>
        <div className={styles.breakdowns}>
          <BarBreakdown title="By custodian or site" bars={bars('location', breakdowns.by_location)} selectedKey={selectedKey} onSelect={choose('location', breakdowns.by_location)} />
          <BarBreakdown title="By type" bars={bars('type', breakdowns.by_type)} selectedKey={selectedKey} onSelect={choose('type', breakdowns.by_type)} />
          <BarBreakdown title="By sensitivity label" bars={bars('label', breakdowns.by_label)} selectedKey={selectedKey} onSelect={choose('label', breakdowns.by_label)} />
        </div>
      </section>

      <MonthChart title="By month" months={breakdowns.by_month} note={monthSpan(breakdowns.by_month)} />

      <ItemTable
        preview={preview}
        matterId={matter.id}
        filter={filter}
        onClearFilter={() => {
          setFilter(null);
          setPage(1);
        }}
        page={page}
        onPage={setPage}
      />
    </>
  );
}

/**
 * The preview no longer matches what would be exported: the draft changed (estimate it on Scope first), or a newer
 * query version (or other sources) hasn't been previewed. An export needs a preview of exactly what it exports.
 */
function StaleBanner({ preview, matter, onRefresh, busy }: { preview: Preview; matter: Matter; onRefresh: () => void; busy: boolean }) {
  if (matter.draft_changed) {
    return (
      <Banner
        title="The search has changed since this preview."
        actions={
          <ButtonLink size="sm" to={`/matters/${encodeURIComponent(matter.id)}/scope`}>
            Go to Scope
          </ButtonLink>
        }
      >
        This preview is of query v{preview.version}. Estimate the changes on Scope, then preview again before you export.
      </Banner>
    );
  }
  const current = matter.current_version;
  if (current !== null && current !== preview.version) {
    return (
      <Banner
        title={`Query v${current} hasn't been previewed.`}
        actions={
          <Button size="sm" variant="highlight" onClick={onRefresh} disabled={busy}>
            Preview query v{current}
          </Button>
        }
      >
        This preview is of query v{preview.version}. Preview again before you export, so the export matches what was reviewed.
      </Banner>
    );
  }
  if (preview.stale) {
    return (
      <Banner
        title="This preview is out of date."
        actions={
          <Button size="sm" variant="highlight" onClick={onRefresh} disabled={busy}>
            Preview again
          </Button>
        }
      >
        The query or who is searched changed after it was made. Preview again before you export.
      </Banner>
    );
  }
  return null;
}
