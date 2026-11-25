// The Export screen (docs/design/Export.dc.html): the export checks, what goes into the package and how, the
// typed confirmation that starts it, the hand-offs, the methodology that goes with it, and the export history.
import { useState } from 'react';
import { useParams } from 'react-router';
import { useMatter } from '@/api/queries';
import { MethodologyCard } from '@/components';
import { CheckCard } from './CheckCard';
import styles from './ExportScreen.module.css';
import { DEFAULT_OPTIONS, quoteTerm } from './format';
import { EverlawCard, OtherHandoffsCard } from './HandoffCards';
import { HistoryCard } from './HistoryCard';
import { shownExportJob, useExportCheck, useExportJobs, useExports, useVersions } from './hooks';
import { OptionsCard, WhatCard } from './OptionsCards';
import { StartCard } from './StartCard';

export function ExportScreen() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId).data;
  const check = useExportCheck(matterId);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const { exportJob, downloadJob, reviewSetJob } = useExportJobs(matterId);
  const live = exportJob.isRunning || downloadJob.isRunning || reviewSetJob.isRunning;
  const list = useExports(matterId, live);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A finished or failed export stays on the Start card until the person sets up the next one.
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);

  const exports = list.data?.items ?? [];
  const selected = exports.find((e) => e.id === selectedId);
  const handoffTarget = selected?.status === 'ready' ? selected : exports.find((e) => e.status === 'ready');

  const counts = check.data?.counts;
  const version = check.data?.version ?? matter?.current_version ?? null;

  // The Everlaw steps describe the export that Start would create (the current query version), and name an existing
  // export only when it is the one on screen: the one the Start card follows, else the one opened in the list.
  const shownJob = shownExportJob(exportJob, dismissedJob);
  const followed =
    shownJob && !shownJob.isFailed
      ? shownJob.result
        ? (exports.find((e) => e.id === shownJob.result!.id) ?? shownJob.result)
        : exports.find((e) => e.status === 'preparing')
      : undefined;
  const named = followed ?? (selected && (selected.status === 'preparing' || selected.status === 'ready') ? selected : undefined);
  const versions = useVersions(matterId).data?.items ?? [];
  const methodology = versions.find((v) => v.version === version);

  return (
    <div className={styles.screen}>
      <h2 className="st-visually-hidden">Export</h2>
      <div className={styles.columns}>
        <div className={styles.main}>
          <CheckCard matterId={matterId} check={check} />
          <WhatCard counts={counts} options={options} />
          <OptionsCard counts={counts} options={options} onChange={setOptions} />
          <StartCard
            matterId={matterId}
            matterNumber={matter?.matter_number}
            check={check}
            options={options}
            exportJob={exportJob}
            dismissedJob={dismissedJob}
            onDismissJob={setDismissedJob}
          />
        </div>
        <aside className={styles.aside} aria-label="Hand-off and methodology">
          <EverlawCard matter={matter} exp={named} nextVersion={version} />
          <OtherHandoffsCard matterId={matterId} matterNumber={matter?.matter_number} exp={handoffTarget} downloadJob={downloadJob} reviewSetJob={reviewSetJob} />
          <section aria-labelledby="export-methodology" className={styles.methodology}>
            <h2 id="export-methodology" className={styles.plainTitle}>
              Methodology sent with this export
            </h2>
            {methodology ? (
              <MethodologyCard lines={methodology.methodology} terms={methodology.criteria.keywords.map(quoteTerm)} />
            ) : (
              <p className={styles.muted}>The methodology appears here once the query is saved as a version.</p>
            )}
          </section>
        </aside>
      </div>
      <HistoryCard matterId={matterId} list={list} selectedId={selectedId} onSelect={setSelectedId} live={live} />
    </div>
  );
}
