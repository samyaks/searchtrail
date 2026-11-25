// "How the set narrowed": every query version with its count, as bars against the largest.
import type { Schemas } from '@/api/client';
import { Card, EmptyState } from '@/components';
import { n, versionNote } from './format';
import styles from './LogScreen.module.css';

export function Narrowing({ versions }: { versions: Schemas['QueryVersion'][] }) {
  const largest = Math.max(1, ...versions.map((v) => v.counts?.items ?? 0));
  const latest = versions[versions.length - 1]?.version;
  return (
    <Card title="How the set narrowed" padding="lg">
      {versions.length === 0 ? (
        <EmptyState>No query versions yet. Estimate a search on the Scope tab to make v1.</EmptyState>
      ) : (
        <ol className={styles.versions} aria-label="Query versions">
          {versions.map((v) => {
            const items = v.counts?.items;
            const width = items === undefined ? 0 : Math.max(2, Math.round((items / largest) * 100));
            return (
              <li key={v.version} className={styles.version}>
                <span className={styles.versionName}>v{v.version}</span>
                <span className={styles.versionBody}>
                  <span className={styles.track} aria-hidden="true">
                    <span className={styles.bar} data-current={v.version === latest ? '' : undefined} style={{ width: `${width}%` }} />
                  </span>
                  <span className={styles.muted}>{versionNote(v)}</span>
                </span>
                <span className={styles.versionItems}>
                  {items === undefined ? (
                    <span className={styles.notEstimated}>Not estimated</span>
                  ) : (
                    <>
                      {n(items)}
                      <span className="st-visually-hidden"> items</span>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
