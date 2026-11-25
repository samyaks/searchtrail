// Every export of the matter, newest first, with its state in Purview and its hand-offs; one opens for detail.
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import type { Schemas } from '@/api/client';
import { Button, Card, DataTable, EmptyState, ErrorNotice, type Column } from '@/components';
import styles from './ExportScreen.module.css';
import { exportStatus, historyItems, longDate, n, sizeText, whenText } from './format';
import { useExport } from './hooks';

type Export = Schemas['Export'];

type Props = {
  matterId: string;
  list: UseQueryResult<Schemas['ExportList']>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  live: boolean;
};

export function HistoryCard({ matterId, list, selectedId, onSelect, live }: Props) {
  const columns: Column<Export>[] = [
    { key: 'name', header: 'Export name', rowHeader: true, cell: (e) => <span className={styles.exportNameCell}>{e.name}</span> },
    { key: 'version', header: 'Query', width: '70px', cell: (e) => `v${e.version}` },
    { key: 'items', header: 'Items', cell: (e) => <span className={styles.nowrap}>{historyItems(e)}</span> },
    { key: 'started', header: 'Started', cell: (e) => <span className={`${styles.mutedText} ${styles.nowrap}`}>{`${whenText(e.started_at)} · ${e.started_by.display_name}`}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => {
        const status = exportStatus(e);
        return (
          <span className={styles.status}>
            <span className={styles.statusLabel} data-tone={status.tone}>
              {status.label}
            </span>
            {status.details.map((line) => (
              <span key={line} className={styles.statusDetail}>
                {line}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      key: 'open',
      header: 'Details',
      hideHeader: true,
      width: '110px',
      cell: (e) => (
        <Button size="sm" aria-expanded={e.id === selectedId} aria-label={`Details of ${e.name}`} onClick={() => onSelect(e.id === selectedId ? null : e.id)}>
          Details
        </Button>
      ),
    },
  ];

  return (
    <Card title="Exports for this matter" padding="none">
      {list.isError ? (
        <div className={styles.inset}>
          <ErrorNotice error={list.error} matterId={matterId} onRetry={() => void list.refetch()} headingLevel={3} />
        </div>
      ) : (
        <div className={styles.tableWrap} aria-busy={list.isPending}>
          <DataTable
            caption="Exports for this matter"
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(e) => e.id}
            selectedKey={selectedId ?? undefined}
            emptyMessage={list.isPending ? 'Loading exports…' : <EmptyState>No exports yet. Start one above once the checks pass.</EmptyState>}
          />
        </div>
      )}
      {selectedId && <ExportDetail exportId={selectedId} matterId={matterId} live={live} />}
    </Card>
  );
}

const OPTION_TEXT = (o: Schemas['ExportOptions']) =>
  [
    o.include_partially_indexed ? 'Partially indexed items included' : 'Partially indexed items left out',
    o.format === 'pst' ? 'PST for emails and chats' : 'MSG for emails and chats',
    o.include_cloud_attachments ? 'Files linked in emails included' : 'Files linked in emails not collected',
    o.teams_transcripts === false ? 'No Teams transcripts' : 'Teams transcripts',
  ].join(' · ');

function ExportDetail({ exportId, matterId, live }: { exportId: string; matterId: string; live: boolean }) {
  const headingId = useId();
  const detail = useExport(exportId, live);
  const e = detail.data;
  return (
    <section aria-labelledby={headingId} className={styles.detail} aria-busy={detail.isPending}>
      <h3 id={headingId} className={styles.handoffTitle}>
        {e ? `Export ${e.name}` : 'Export details'}
      </h3>
      {detail.isError && <ErrorNotice error={detail.error} matterId={matterId} onRetry={() => void detail.refetch()} headingLevel={3} />}
      {detail.isPending && <p className={styles.muted}>Loading…</p>}
      {e && (
        <dl className={styles.facts}>
          <div>
            <dt>Status</dt>
            <dd>
              {exportStatus(e).label}
              {e.status === 'preparing' ? ` · ${Math.round(e.progress * 100)}%` : ''}
            </dd>
          </div>
          <div>
            <dt>Counts</dt>
            <dd>
              {n(e.counts.items)} items ({sizeText(e.counts.size_bytes)})
              {e.options.include_partially_indexed && e.counts.partial_items > 0 ? ` + ${n(e.counts.partial_items)} partially indexed (${sizeText(e.counts.partial_size_bytes)})` : ''}
            </dd>
          </div>
          <div>
            <dt>Options</dt>
            <dd>{OPTION_TEXT(e.options)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>
              {whenText(e.started_at)} by {e.started_by.display_name}
              {e.changes_accepted ? ', accepting counts that changed since the preview' : ''}
            </dd>
          </div>
          {e.finished_at && (
            <div>
              <dt>Ready</dt>
              <dd>
                {whenText(e.finished_at)}
                {e.expires_at ? `; Purview deletes the download on ${longDate(e.expires_at)}` : ''}
              </dd>
            </div>
          )}
          <div>
            <dt>Files</dt>
            <dd>{e.files.length ? e.files.map((f) => `${f.name}${f.size_bytes != null ? ` (${sizeText(f.size_bytes)})` : ''}`).join(', ') : 'None yet'}</dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>
              {e.download.status === 'done'
                ? `Stored in SearchTrail at ${e.download.stored_path ?? 'its storage'}`
                : e.download.status === 'running'
                  ? `Downloading · ${Math.round((e.download.progress ?? 0) * 100)}%`
                  : e.download.status === 'failed'
                    ? "Didn't finish"
                    : 'Not downloaded'}
            </dd>
          </div>
          <div>
            <dt>Review set</dt>
            <dd>
              {e.review_set.status === 'done'
                ? `In ${e.review_set.name ?? 'a review set'}`
                : e.review_set.status === 'running'
                  ? `Adding to ${e.review_set.name ?? 'a review set'}`
                  : e.review_set.status === 'failed'
                    ? "Didn't finish"
                    : 'Not sent'}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
