// Matters list (docs/design/Main.dc.html). Phase 0: proves the pipeline end to end
// (contract -> generated types -> typed client -> TanStack Query -> MSW mocks). WS-E finishes it.
import { useState } from 'react';
import { Link } from 'react-router';
import type { Schemas } from '@/api/client';
import { useMatters } from '@/api/queries';
import { activityText, itemsText, STAGE_LABELS, stageText } from './format';
import styles from './MattersScreen.module.css';

const FILTERS: (Schemas['MatterStage'] | undefined)[] = [undefined, 'scoping', 'previewed', 'exporting', 'exported'];

export function MattersScreen() {
  const [stage, setStage] = useState<Schemas['MatterStage'] | undefined>();
  const matters = useMatters(stage);

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Matters</h1>
          <p className={styles.intro}>
            Each matter is a Purview eDiscovery case that SearchTrail keeps in step with your search decisions.
          </p>
        </div>
      </div>

      <div role="group" aria-label="Filter by stage" className={styles.filters}>
        {FILTERS.map((s) => (
          <button
            key={s ?? 'all'}
            type="button"
            className={styles.chip}
            aria-pressed={stage === s}
            onClick={() => setStage(s)}
          >
            {s ? STAGE_LABELS[s] : 'All'}
          </button>
        ))}
      </div>

      {matters.isPending && <p>Loading matters…</p>}
      {matters.isError && (
        <p role="alert" className={styles.error}>
          {matters.error.message}
        </p>
      )}
      {matters.data && (
        <table className={styles.table} aria-label="Matters">
          <thead>
            <tr>
              <th scope="col">Matter</th>
              <th scope="col">Stage</th>
              <th scope="col">Custodians</th>
              <th scope="col">Latest query</th>
              <th scope="col">Last activity</th>
              <th scope="col">Owner</th>
            </tr>
          </thead>
          <tbody>
            {matters.data.items.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className={styles.id}>{m.matter_number}</span>
                  <Link to={`/matters/${m.id}/scope`} className={styles.name}>
                    {m.name}
                  </Link>
                </td>
                <td>
                  <span className={styles.pill} data-stage={m.stage}>
                    {stageText(m)}
                  </span>
                </td>
                <td>{m.custodian_count}</td>
                <td>
                  <span className={styles.version}>{m.current_version ? `Query v${m.current_version}` : 'No query yet'}</span>
                  <span className={styles.muted}>{itemsText(m)}</span>
                </td>
                <td>{activityText(m.last_activity_at)}</td>
                <td>{m.owner.display_name}</td>
              </tr>
            ))}
            {matters.data.items.length === 0 && (
              <tr>
                <td colSpan={6}>No matters match. Choose All.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
