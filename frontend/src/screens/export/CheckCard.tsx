// The export checks, as Purview would see them now: previewed, same sources, counts unchanged.
import type { UseQueryResult } from '@tanstack/react-query';
import type { Schemas } from '@/api/client';
import { Button, Card, ErrorNotice, Pill } from '@/components';
import styles from './ExportScreen.module.css';
import { CheckMark } from './icons';

const PREFIX = { passed: 'Passed:', failed: 'Failed:', skipped: 'Not checked:' } as const;

export function CheckCard({ matterId, check }: { matterId: string; check: UseQueryResult<Schemas['ExportCheck']> }) {
  const data = check.data;
  const badge = check.isFetching && !data ? (
    <Pill tone="neutral">Checking</Pill>
  ) : data?.ready ? (
    <Pill tone="ok">Ready</Pill>
  ) : data ? (
    <Pill tone="danger">Blocked</Pill>
  ) : undefined;

  return (
    <Card title="Export check" padding="lg" actions={badge}>
      {check.isError && !check.isFetching ? (
        <ErrorNotice error={check.error} matterId={matterId} onRetry={() => void check.refetch()} headingLevel={3} />
      ) : !data ? (
        <p className={styles.muted} aria-busy="true">
          Checking with Purview…
        </p>
      ) : (
        <ul className={styles.checks} aria-label="Checks" aria-busy={check.isFetching}>
          {data.checks.map((item) => (
            <li key={item.key} className={styles.check} data-status={item.status}>
              <CheckMark status={item.status} />
              <span>
                <strong>{PREFIX[item.status]}</strong> {item.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.cardFoot}>
        <p className={styles.note}>If any check fails, SearchTrail stops before contacting Purview and tells you what changed.</p>
        {(data || check.isError) && (
          <Button size="sm" onClick={() => void check.refetch()} disabled={check.isFetching}>
            {check.isFetching ? 'Checking…' : 'Check again'}
          </Button>
        )}
      </div>
    </Card>
  );
}
