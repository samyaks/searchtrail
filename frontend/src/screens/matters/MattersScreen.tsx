// Matters list (docs/design/Main.dc.html): stage chips with counts, a search, the table, and the New matter form.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Schemas } from '@/api/client';
import { Button, type Column, DataTable, ErrorNotice, FilterChip, Pill, type PillTone } from '@/components';
import { activityText, itemsText, STAGE_LABELS, stageText } from './format';
import { useDebouncedValue, useMatterList, useStageCounts } from './hooks';
import { NewMatterForm } from './NewMatterForm';
import styles from './MattersScreen.module.css';

type Stage = Schemas['MatterStage'];
type Matter = Schemas['MatterSummary'];

const FILTERS: (Stage | undefined)[] = [undefined, 'scoping', 'previewed', 'exporting', 'exported'];
const TONES: Record<Stage, PillTone> = { scoping: 'neutral', previewed: 'highlight', exporting: 'ink', exported: 'ok' };

const COLUMNS: Column<Matter>[] = [
  {
    key: 'matter',
    header: 'Matter',
    rowHeader: true,
    cell: (m) => (
      <span className={styles.matter}>
        <span className={styles.id}>{m.matter_number}</span>
        <Link to={`/matters/${encodeURIComponent(m.id)}/scope`} className={styles.name}>
          {m.name}
        </Link>
      </span>
    ),
  },
  { key: 'stage', header: 'Stage', width: '150px', cell: (m) => <Pill tone={TONES[m.stage]}>{stageText(m)}</Pill> },
  { key: 'custodians', header: 'Custodians', width: '110px', cell: (m) => <span className={styles.number}>{m.custodian_count}</span> },
  {
    key: 'query',
    header: 'Latest query',
    width: '170px',
    cell: (m) => (
      <span className={styles.query}>
        <span className={styles.version}>{m.current_version ? `Query v${m.current_version}` : 'No query yet'}</span>
        <span className={styles.items}>{itemsText(m)}</span>
      </span>
    ),
  },
  { key: 'activity', header: 'Last activity', width: '140px', cell: (m) => <span className={styles.muted}>{activityText(m.last_activity_at)}</span> },
  { key: 'owner', header: 'Owner', width: '160px', cell: (m) => m.owner.display_name },
];

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function MattersScreen() {
  const [stage, setStage] = useState<Stage | undefined>();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const formId = useId();
  const searchId = useId();
  const headerActions = useRef<HTMLDivElement>(null);

  const q = useDebouncedValue(search.trim()) || undefined;
  const matters = useMatterList({ stage, q });
  const counts = useStageCounts();

  // When the form closes, focus goes back to the button that opened it, so keyboard users keep their place.
  const wasCreating = useRef(false);
  useEffect(() => {
    if (wasCreating.current && !creating) headerActions.current?.querySelector('button')?.focus();
    wasCreating.current = creating;
  }, [creating]);

  const emptyMessage =
    !stage && !q ? 'No matters yet. Choose New matter to create the first one.' : 'No matters match. Clear the search or choose All.';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h1>Matters</h1>
          <p className={styles.intro}>Each matter is a Purview eDiscovery case that SearchTrail keeps in step with your search decisions.</p>
        </div>
        {!creating && (
          <div ref={headerActions}>
            <Button variant="primary" icon={<PlusIcon />} aria-expanded={false} aria-controls={formId} onClick={() => setCreating(true)}>
              New matter
            </Button>
          </div>
        )}
      </div>

      {creating && <NewMatterForm id={formId} onCancel={() => setCreating(false)} />}

      <div className={styles.toolbar}>
        <div role="group" aria-label="Filter by stage" className={styles.filters}>
          {FILTERS.map((s) => (
            <FilterChip key={s ?? 'all'} pressed={stage === s} count={counts && (s ? counts[s] : counts.all)} onClick={() => setStage(s)}>
              {s ? STAGE_LABELS[s] : 'All'}
            </FilterChip>
          ))}
        </div>
        <div className={styles.search}>
          <label htmlFor={searchId}>Search matters</label>
          <input
            id={searchId}
            type="search"
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Matter ID or name"
            autoComplete="off"
          />
        </div>
      </div>

      {matters.isPending && <p className={styles.muted}>Loading matters…</p>}
      {matters.isError && <ErrorNotice error={matters.error} onRetry={() => void matters.refetch()} />}
      {matters.data && (
        <div aria-busy={matters.isPlaceholderData}>
          <DataTable caption="Matters" columns={COLUMNS} rows={matters.data.items} rowKey={(m) => m.id} emptyMessage={emptyMessage} />
        </div>
      )}
    </div>
  );
}
