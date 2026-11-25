// Scope (docs/design/Scope.dc.html): the filters of the search, with the live KQL and methodology the API writes
// for them, the saved draft, and the estimate.
//
// The browser never builds KQL: every edit is sent (debounced) to POST /kql/preview, which answers with the
// query, its methodology and any warnings, or with criteria_invalid. Edits are saved to the draft as they
// settle; Estimate saves anything not yet saved, then starts an estimate job and follows it.
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiRequestError, type Schemas } from '@/api/client';
import { hasCode } from '@/api/errors';
import { useTrackedJob } from '@/api/jobs';
import { queryKeys, useMatter } from '@/api/queries';
import { dayAndTime } from '@/app/time';
import { ErrorNotice } from '@/components';
import { markForms, SECTION_NAMES, sectionOf, stableKey, type Criteria, type Section } from './criteria';
import { ExpertSection, LabelsSection, TermsSection, WhenSection, WhoCard } from './FilterSections';
import { SaveFailedFirst, scopeKeys, timing, useDebounced, useDraft, useKqlPreview, useSaveDraft, useStartEstimate, useVersions } from './hooks';
import styles from './ScopeScreen.module.css';
import { EstimatePanel, KqlPanel, MethodologyPanel, type ShownEstimate } from './SummaryPanels';

export function ScopeScreen() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);
  const draft = useDraft(matterId);
  const saving = useIsMutating({ mutationKey: scopeKeys.saves(matterId) }) > 0;

  // The editor starts from the saved draft once, then keeps the person's edits. So it waits for the draft as it
  // is now: read since the screen opened (not an old copy in the cache), with no save of it still on its way
  // (one sent as the person left the screen, say). Once shown, it stays.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  if (readyFor !== matterId && draft.data && draft.isFetchedAfterMount && !draft.isFetching && !saving) setReadyFor(matterId);

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
  // was asked for; `latest` is what's on screen, so an edit made just before leaving the screen is still saved.
  const { mutate: saveDraft, mutateAsync: saveDraftNow } = save;
  const requested = useRef(stableKey(initial));
  const latest = useRef(initial);
  useEffect(() => {
    const key = stableKey(settled);
    if (key === requested.current) return;
    requested.current = key;
    saveDraft(settled);
  }, [settled, saveDraft]);
  useEffect(
    () => () => {
      if (stableKey(latest.current) === requested.current) return;
      requested.current = stableKey(latest.current);
      saveDraft(latest.current);
    },
    [saveDraft],
  );

  const change = (next: Criteria) => {
    latest.current = next;
    setCriteria(next);
    setStartError(null);
  };

  const retrySave = () => {
    requested.current = stableKey(criteria);
    saveDraft(criteria);
  };

  const runEstimate = async () => {
    setStartError(null);
    setStarting(true);
    try {
      // The estimate is of the saved draft, so save what's on screen first unless a save of it was already asked
      // for (and didn't fail). The estimate waits behind any save still on its way (they share a mutation scope).
      const key = stableKey(criteria);
      if (key !== requested.current || save.isError) {
        requested.current = key;
        try {
          await saveDraftNow(criteria);
        } catch {
          return; // the save's own notice says why, with Try again; nothing was sent to Purview
        }
      }
      const job = await startEstimate.mutateAsync();
      estimate.track(job.id);
    } catch (error) {
      const running = runningJobId(error);
      if (running) estimate.track(running);
      else if (!(error instanceof SaveFailedFirst)) setStartError(error);
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
  const versionLabel = current === null || changed ? `Query v${nextVersion} (draft)` : `Query v${current}`;

  return (
    <div className={styles.columns}>
      <div className={styles.filters}>
        <WhoCard matter={matter} />
        <TermsSection criteria={criteria} onChange={change} problem={problemFor('terms')} />
        <WhenSection criteria={criteria} onChange={change} problem={problemFor('dates')} typesProblem={problemFor('types')} />
        <LabelsSection criteria={criteria} onChange={change} problem={problemFor('labels')} />
        <ExpertSection criteria={criteria} onChange={change} problem={problemFor('expert')} />
        {save.isError ? (
          <ErrorNotice error={save.error} onRetry={retrySave} headingLevel={3} />
        ) : (
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
