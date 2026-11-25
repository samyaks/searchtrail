// Scope (docs/design/Scope.dc.html): the filters of the search, with the live KQL and methodology the API writes
// for them, the saved draft, and the estimate.
//
// The browser never builds KQL: every edit is sent (debounced) to POST /kql/preview, which answers with the
// query, its methodology and any warnings, or with criteria_invalid. Edits are saved to the draft as they
// settle; Estimate saves anything not yet saved, then starts an estimate job and follows it.
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, type Schemas } from '@/api/client';
import { hasCode } from '@/api/errors';
import { useTrackedJob } from '@/api/jobs';
import { queryKeys, useMatter } from '@/api/queries';
import { dayAndTime } from '@/app/time';
import { ErrorNotice } from '@/components';
import { markForms, SECTION_NAMES, sectionOf, stableKey, type Criteria, type Section } from './criteria';
import { ADD_TERM_ID, ExpertSection, LabelsSection, TermsSection, WhenSection, WhoCard } from './FilterSections';
import { scopeKeys, timing, useDebounced, useDraft, useKqlPreview, useSaveDraft, useStartEstimate, useVersions } from './hooks';
import styles from './ScopeScreen.module.css';
import { EstimatePanel, KqlPanel, MethodologyPanel, type ShownEstimate } from './SummaryPanels';

export function ScopeScreen() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);
  const draft = useDraft(matterId);
  const saving = useIsMutating({ mutationKey: scopeKeys.saves(matterId) }) > 0;

  // The editor starts from the saved draft once, then keeps the person's edits. So it waits for the draft as it
  // is now: read well since the screen opened (not an old copy in the cache, and not one left there by a read
  // that failed), with no save of it still on its way (one sent as the person left the screen, say). Once
  // shown, it stays.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  if (readyFor !== matterId && draft.isSuccess && draft.isFetchedAfterMount && !draft.isFetching && !saving) setReadyFor(matterId);

  let body;
  if (draft.isError && readyFor !== matterId) {
    body = <ErrorNotice error={draft.error} matterId={matterId} onRetry={() => void draft.refetch()} headingLevel={3} />;
  } else if (!draft.data || !matter.data || readyFor !== matterId) body = <p className={styles.muted14}>Loading the search…</p>;
  // Keyed by matter, so another matter starts from its own draft.
  else body = <ScopeEditor key={matterId} matter={matter.data} initial={draft.data.criteria} />;

  return (
    <section aria-labelledby="scope-title" className={styles.screen}>
      <h2 id="scope-title" className="st-visually-hidden">
        Scope
      </h2>
      {body}
    </section>
  );
}

/** The job a 409 says is already running ("Follow it instead", the contract's JobAlreadyRunning). */
function runningJobId(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.body.code !== 'conflict') return null;
  const id = error.body.details.job_id;
  return typeof id === 'string' ? id : null;
}

function ScopeEditor({ matter, initial }: { matter: Schemas['Matter']; initial: Criteria }) {
  const matterId = matter.id;
  const client = useQueryClient();
  const [criteria, setCriteria] = useState<Criteria>(initial);
  const settled = useDebounced(criteria, timing.debounceMs);

  const kql = useKqlPreview(settled);
  const draft = useDraft(matterId);
  const versions = useVersions(matterId);
  const save = useSaveDraft(matterId);
  const startEstimate = useStartEstimate(matterId);
  const estimate = useTrackedJob(matterId, 'estimate', { pollMs: timing.pollMs });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [saveTrouble, setSaveTrouble] = useState(false);
  const [savedAgain, setSavedAgain] = useState(false);
  // (Setting state while rendering, guarded like this, is React's way to derive state from a change.)
  if (save.isError && !saveTrouble) {
    setSaveTrouble(true);
    setSavedAgain(false);
  } else if (save.isSuccess && saveTrouble) {
    setSaveTrouble(false);
    setSavedAgain(true);
  }

  // Save the draft whenever the edits settle on something not saved yet. `requested` is the last criteria a save
  // was asked for and `lastSave` that save's promise; `latest` is what's on screen, so an edit made just before
  // leaving the screen is still saved. `lastFailed` says the last save asked for failed (the session had ended,
  // say): leaving the screen then sends it again, so an edit shown as not saved isn't lost by moving on.
  const { mutateAsync: saveDraftNow } = save;
  const requested = useRef(stableKey(initial));
  const lastSave = useRef<Promise<unknown> | null>(null);
  const lastFailed = useRef(false);
  const latest = useRef(initial);
  const requestSave = useCallback(
    (next: Criteria) => {
      requested.current = stableKey(next);
      lastFailed.current = false;
      const saved = saveDraftNow(next);
      lastSave.current = saved;
      // A failure is shown by the save's own notice, with Try again.
      saved.catch(() => {
        if (lastSave.current === saved) lastFailed.current = true;
      });
      return saved;
    },
    [saveDraftNow],
  );
  useEffect(() => {
    if (stableKey(settled) !== requested.current) void requestSave(settled);
  }, [settled, requestSave]);
  useEffect(
    () => () => {
      if (stableKey(latest.current) !== requested.current || lastFailed.current) void requestSave(latest.current);
    },
    [requestSave],
  );
  // Closing or reloading the page can't save anything: while an edit is known not to be saved, the browser asks first.
  const unsaved = save.isError;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // older browsers ask only when this is set
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const change = (next: Criteria) => {
    latest.current = next;
    setCriteria(next);
    setStartError(null);
  };

  // Try again sends the save, and the notice goes while it's on its way. Focus was in the notice (on Try again),
  // so it moves first to the field for adding a term, at the top of the filters, rather than fall to the page's body.
  const noticeBox = useRef<HTMLDivElement>(null);
  const retrySave = () => {
    if (noticeBox.current?.contains(document.activeElement)) document.getElementById(ADD_TERM_ID)?.focus();
    void requestSave(criteria);
  };

  const runEstimate = async () => {
    if (blocked) return;
    setStartError(null);
    setStarting(true);
    try {
      // The estimate is of the saved draft, so it waits for the save of what's on screen now: the last save asked
      // for, or a new one if none was asked for this yet (or the last one failed). If that save fails, its own
      // notice says why, with Try again, and nothing is sent to Purview. If a later edit's save has taken over that
      // notice by then, the failure is shown here instead, so Estimate never fails without a word.
      const key = stableKey(criteria);
      const before = key !== requested.current || save.isError ? requestSave(criteria) : lastSave.current;
      try {
        await before;
      } catch (saveError) {
        if (lastSave.current !== before) setStartError(saveError);
        return;
      }
      const job = await startEstimate.mutateAsync();
      estimate.track(job.id);
    } catch (error) {
      const running = runningJobId(error);
      if (running) estimate.track(running);
      else setStartError(error);
    } finally {
      setStarting(false);
      // A changed draft became a new query version: the draft, the versions and the header move on.
      void client.invalidateQueries({ queryKey: scopeKeys.draft(matterId) });
      void client.invalidateQueries({ queryKey: scopeKeys.versions(matterId) });
      void client.invalidateQueries({ queryKey: queryKeys.matter(matterId), exact: true });
    }
  };

  // criteria_invalid, from the live preview or from Estimate, is shown under the field it is about.
  const kqlInvalid = hasCode(kql.error, 'criteria_invalid') ? (kql.error as ApiRequestError) : null;
  const startInvalid = hasCode(startError, 'criteria_invalid') ? (startError as ApiRequestError) : null;
  const invalid = kqlInvalid ?? startInvalid;
  const invalidAt = invalid ? sectionOf(invalid.body.details.field) : null;
  const problemFor = (section: Section) => (invalid && invalidAt === section ? invalid.body.message : null);
  // A query that can't be run isn't offered to Purview at all: Estimate is off, with the reason next to it. The dates
  // are checked as they are typed; anything else the API can't build a query from is known from the live preview.
  const backwards = Boolean(criteria.date_from && criteria.date_to && criteria.date_from > criteria.date_to);
  const blocked = backwards
    ? 'Estimate is off: the From date is after the To date, so nothing can match. Fix the dates first.'
    : kqlInvalid
      ? `Estimate is off until the query can be built. Fix the problem ${invalidAt ? `under ${SECTION_NAMES[invalidAt]}` : 'shown with the query'} first.`
      : null;

  // What the counts are for, and the version an estimate would be.
  const current = matter.current_version;
  const changed = draft.data?.changed_since_version ?? false;
  const nextVersion = current === null || changed ? (current ?? 0) + 1 : current;
  const result = estimate.result;
  const currentVersion = versions.data?.items.find((v) => v.version === current);
  const busy = starting || estimate.isRunning;
  let shown: ShownEstimate | null = null;
  if (result && result.version >= (current ?? 0)) shown = { version: result.version, at: result.estimated_at, counts: result.counts };
  else if (currentVersion?.counts) shown = { version: currentVersion.version, at: currentVersion.created_at, counts: currentVersion.counts };
  else if (busy) {
    // While an estimate runs, its new version has no counts yet: keep the newest counts there are, shown as stale.
    const counted = versions.data?.items.filter((v) => v.counts).sort((a, b) => b.version - a.version)[0];
    if (counted?.counts) shown = { version: counted.version, at: counted.created_at, counts: counted.counts };
  }
  // While the last save failed, what's on screen isn't the saved draft: the methodology says the version the edit
  // would be part of, and that the last change isn't saved, so it doesn't pass the edit off as saved.
  const versionLabel = save.isError
    ? `Query v${(current ?? 0) + 1} (draft) · last change not saved`
    : current === null || changed
      ? `Query v${nextVersion} (draft)`
      : `Query v${current}`;

  return (
    <div className={styles.columns}>
      <div className={styles.filters}>
        {/* A save that failed is said at the top, where the person is looking, not under the last filter. */}
        {save.isError && (
          <div ref={noticeBox}>
            <ErrorNotice error={save.error} onRetry={retrySave} headingLevel={3} change />
          </div>
        )}
        <WhoCard matter={matter} />
        <TermsSection criteria={criteria} onChange={change} problem={problemFor('terms')} />
        <WhenSection criteria={criteria} onChange={change} problem={problemFor('dates')} typesProblem={problemFor('types')} />
        <LabelsSection criteria={criteria} onChange={change} problem={problemFor('labels')} />
        <ExpertSection criteria={criteria} onChange={change} problem={problemFor('expert')} />
        {!save.isError && (
          <p className={styles.hint}>
            {save.isPending
              ? 'Saving the draft…'
              : draft.data
                ? `Changes are saved as you go. Draft saved ${dayAndTime(draft.data.updated_at)}.`
                : 'Changes are saved as you go.'}
          </p>
        )}
        {/* Saving as you go isn't announced; a failure is (the notice is an alert), and so is saving again after one. */}
        <p role="status" className="st-visually-hidden">
          {savedAgain ? 'The draft is saved.' : ''}
        </p>
      </div>

      <aside aria-label="Estimate and methodology" className={styles.summary}>
        <EstimatePanel
          matter={matter}
          shown={shown}
          changed={changed}
          nextVersion={nextVersion}
          busy={busy}
          progress={estimate.isRunning && estimate.job ? estimate.progress : null}
          failure={estimate.failure}
          startError={startInvalid ? null : startError}
          invalidNote={
            startInvalid
              ? `Nothing was sent to Purview. Fix the problem ${invalidAt ? `under ${SECTION_NAMES[invalidAt]}` : 'shown with the query'}, then estimate again.`
              : null
          }
          blocked={blocked}
          onEstimate={() => void runEstimate()}
        />
        <MethodologyPanel
          matterNumber={matter.matter_number}
          versionLabel={versionLabel}
          lines={kql.data?.methodology ?? null}
          terms={markForms(settled.keywords)}
          unavailable={invalid ? 'The methodology appears once the query can be built.' : null}
        />
        <KqlPanel
          preview={kql.data}
          problem={invalid && !invalidAt ? invalid.body.message : null}
          problemAt={invalid && invalidAt ? SECTION_NAMES[invalidAt] : null}
          error={kql.isError && !kqlInvalid ? kql.error : null}
          onRetry={() => void kql.refetch()}
        />
      </aside>
    </div>
  );
}
