// Scope (docs/design/Scope.dc.html): the filters of the search, with the live KQL and methodology the API writes
// for them, the saved draft, and the estimate.
//
// The browser never builds KQL: every edit is sent (debounced) to POST /kql/preview, which answers with the
// query, its methodology and any warnings, or with criteria_invalid. Edits are saved to the draft as they
// settle; Estimate saves anything not yet saved, then starts an estimate job and follows it.
import { useQueryClient } from '@tanstack/react-query';
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
import { scopeKeys, timing, useDebounced, useDraft, useKqlPreview, useSaveDraft, useStartEstimate, useVersions } from './hooks';
import styles from './ScopeScreen.module.css';
import { EstimatePanel, KqlPanel, MethodologyPanel, type ShownEstimate } from './SummaryPanels';

export function ScopeScreen() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);
  const draft = useDraft(matterId);

  let body;
  if (draft.isError) body = <ErrorNotice error={draft.error} matterId={matterId} onRetry={() => void draft.refetch()} headingLevel={2} />;
  else if (!draft.data || !matter.data) body = <p className={styles.muted14}>Loading the search…</p>;
  // Keyed by matter: the editor starts from the saved draft once, then keeps the person's edits.
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

  // Save the draft whenever the edits settle on something not saved yet.
  const { mutate: saveDraft, mutateAsync: saveDraftNow } = save;
  const requested = useRef(stableKey(initial));
  useEffect(() => {
    const key = stableKey(settled);
    if (key === requested.current) return;
    requested.current = key;
    saveDraft(settled);
  }, [settled, saveDraft]);

  const change = (next: Criteria) => {
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
      // The estimate is of the saved draft, so save what's on screen first if it isn't saved yet.
      const saved = client.getQueryData<Schemas['Draft']>(scopeKeys.draft(matterId));
      if (!saved || stableKey(saved.criteria) !== stableKey(criteria)) {
        requested.current = stableKey(criteria);
        await saveDraftNow(criteria);
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

  // What the counts are for, and the version an estimate would be.
  const current = matter.current_version;
  const changed = draft.data?.changed_since_version ?? false;
  const nextVersion = current === null || changed ? (current ?? 0) + 1 : current;
  const latest = estimate.result;
  const currentVersion = versions.data?.items.find((v) => v.version === current);
  let shown: ShownEstimate | null = null;
  if (latest && latest.version >= (current ?? 0)) shown = { version: latest.version, at: latest.estimated_at, counts: latest.counts };
  else if (currentVersion?.counts) shown = { version: currentVersion.version, at: currentVersion.created_at, counts: currentVersion.counts };
  const busy = starting || estimate.isRunning;
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
          <p role="status" className={styles.hint}>
            {save.isPending
              ? 'Saving the draft…'
              : draft.data
                ? `Changes are saved as you go. Draft saved ${dayAndTime(draft.data.updated_at)}.`
                : 'Changes are saved as you go.'}
          </p>
        )}
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
          terms={markForms(criteria.keywords)}
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
