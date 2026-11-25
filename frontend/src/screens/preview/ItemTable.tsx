// The item table: one page of the preview's items, filtered by the chosen bar, with paging and the full list as CSV.
import { useRef } from 'react';
import type { Schemas } from '@/api/client';
import { dateText } from '@/app/time';
import { Button, ButtonLink, DataTable, ErrorNotice, type Column } from '@/components';
import { captionText, showingText, sizeText, toItemFilter, TYPE_LABELS, type BarFilter } from './format';
import { PAGE_SIZE, usePreviewItems } from './hooks';
import styles from './PreviewScreen.module.css';

type Item = Schemas['PreviewItem'];

function TypeIcon({ type }: { type: Item['type'] }) {
  const common = { 'aria-hidden': true, width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, className: styles.typeIcon } as const;
  if (type === 'email')
    return (
      <svg {...common}>
        <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
        <path d="M2.5 4.5L8 9l5.5-4.5" />
      </svg>
    );
  if (type === 'teams_chat')
    return (
      <svg {...common} strokeLinejoin="round">
        <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
      </svg>
    );
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M4 1.5h5.5l3 3v10H4z" />
      <path d="M9.5 1.5v3h3" />
    </svg>
  );
}

const LockIcon = () => (
  <svg role="img" aria-label="Encrypted" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={styles.lock}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

function LabelTag({ label }: { label: string | null }) {
  const tone = label === null ? 'none' : label === 'Highly Confidential' ? 'high' : 'plain';
  return (
    <span className={styles.label} data-tone={tone}>
      {label ?? 'No label'}
    </span>
  );
}

const COLUMNS: Column<Item>[] = [
  {
    key: 'item',
    header: 'Item',
    rowHeader: true,
    width: '34%',
    cell: (item) => (
      <span className={styles.itemCell}>
        <TypeIcon type={item.type} />
        <span className={styles.itemTitle} title={item.title}>
          {item.title}
        </span>
        {item.encrypted && <LockIcon />}
      </span>
    ),
  },
  { key: 'location', header: 'Location', cell: (item) => <span className={styles.mutedCell}>{item.location}</span> },
  { key: 'type', header: 'Type', cell: (item) => TYPE_LABELS[item.type] },
  { key: 'date', header: 'Date', cell: (item) => <span className={styles.mutedCell}>{item.date ? dateText(item.date) : 'No date'}</span> },
  { key: 'label', header: 'Sensitivity label', cell: (item) => <LabelTag label={item.label} /> },
  { key: 'size', header: 'Size', numeric: true, cell: (item) => <span className={styles.mutedCell}>{sizeText(item.size_bytes)}</span> },
];

const CloseIcon = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 3l8 8M11 3l-8 8" />
  </svg>
);

type Props = {
  preview: Schemas['Preview'];
  matterId: string;
  filter: BarFilter | null;
  onClearFilter: () => void;
  page: number;
  onPage: (page: number) => void;
};

/** A pager button that stays focusable at the first or last page (a disabled button would drop the focus). */
function PageButton({ onPress, unavailable, children }: { onPress: () => void; unavailable: boolean; children: string }) {
  return (
    <Button size="sm" aria-disabled={unavailable} onClick={unavailable ? undefined : onPress}>
      {children}
    </Button>
  );
}

export function ItemTable({ preview, matterId, filter, onClearFilter, page, onPage }: Props) {
  const items = usePreviewItems(preview.id, toItemFilter(filter), page);
  const heading = useRef<HTMLHeadingElement>(null);
  // While another filter or page loads, the last page stays on screen: don't describe it as the new one.
  const loading = !items.data || items.isPlaceholderData;
  const data = items.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const clearFilter = () => {
    onClearFilter();
    // The chip goes away with the filter: keep the focus nearby, on the table's heading.
    heading.current?.focus();
  };

  return (
    <section aria-labelledby="preview-items" className={styles.itemsCard}>
      <div className={styles.itemsHead}>
        <div className={styles.itemsTitle}>
          <h2 id="preview-items" ref={heading} tabIndex={-1} className={styles.h2Small}>
            Items
          </h2>
          <span role="status" className={styles.muted}>
            {items.isError ? '' : loading ? 'Loading items…' : showingText(data!, filter)}
          </span>
        </div>
        {filter && (
          <button type="button" className={styles.clearChip} onClick={clearFilter} aria-label={`Clear filter: ${filter.name}`}>
            {filter.name}
            <CloseIcon />
          </button>
        )}
      </div>

      {items.isError ? (
        <div className={styles.itemsError}>
          <ErrorNotice error={items.error} matterId={matterId} onRetry={() => void items.refetch()} headingLevel={3} />
        </div>
      ) : (
        <div className={styles.tableWrap} aria-busy={items.isFetching}>
          <DataTable
            caption={loading ? 'Items' : captionText(filter)}
            columns={COLUMNS}
            rows={data?.items ?? []}
            rowKey={(item) => item.id}
            emptyMessage={data ? (filter ? 'None of the items match this filter.' : 'This preview found no items.') : 'Loading items…'}
          />
        </div>
      )}

      <div className={styles.itemsFoot}>
        {data && data.total > PAGE_SIZE && (
          <nav aria-label="Item pages" className={styles.pager}>
            <PageButton onPress={() => onPage(page - 1)} unavailable={page <= 1}>
              Previous
            </PageButton>
            <span>
              Page {page} of {pages.toLocaleString('en-US')}
            </span>
            <PageButton onPress={() => onPage(page + 1)} unavailable={page >= pages}>
              Next
            </PageButton>
          </nav>
        )}
        <span>The full list of {preview.report_items.toLocaleString('en-US')} items is in preview.csv.</span>
        <ButtonLink variant="primary" to={`/matters/${encodeURIComponent(matterId)}/export`}>
          Continue to export
        </ButtonLink>
      </div>
    </section>
  );
}
