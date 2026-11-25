// Two neighbouring query versions side by side: what was added and removed, what stayed, and how the count moved.
import { useId, useState } from 'react';
import type { Schemas } from '@/api/client';
import { Card, EmptyState, ErrorNotice, SegmentedControl } from '@/components';
import { countChange } from './format';
import { useComparison } from './hooks';
import styles from './LogScreen.module.css';

type Pair = { from: number; to: number };

/** More pairs than this are offered in a list instead of as buttons. */
const MAX_BUTTONS = 4;

function PairPicker({ pairs, value, onChange }: { pairs: Pair[]; value: Pair; onChange: (to: number) => void }) {
  const selectId = useId();
  const label = (p: Pair) => `v${p.from} → v${p.to}`;
  if (pairs.length <= MAX_BUTTONS) {
    return (
      <SegmentedControl
        label="Versions to compare"
        options={pairs.map((p) => ({ value: String(p.to), label: label(p) }))}
        value={String(value.to)}
        onChange={(to) => onChange(Number(to))}
      />
    );
  }
  return (
    <span className={styles.pickerSelect}>
      <label htmlFor={selectId}>Versions to compare</label>
      <select id={selectId} value={value.to} onChange={(event) => onChange(Number(event.target.value))}>
        {[...pairs].reverse().map((p) => (
          <option key={p.to} value={p.to}>
            {label(p)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** A key for each change from what it says, numbered only when the same change is listed twice. */
function changeKeys(changes: Schemas['VersionComparison']['changes']): string[] {
  const seen = new Map<string, number>();
  return changes.map((c) => {
    const base = `${c.change}:${c.text}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

function Comparison({ comparison }: { comparison: Schemas['VersionComparison'] }) {
  const keys = changeKeys(comparison.changes);
  return (
    <>
      {comparison.changes.length > 0 ? (
        <ul className={styles.diff} aria-label="Changes">
          {comparison.changes.map((c, i) => (
            <li key={keys[i]} className={styles.diffLine} data-change={c.change}>
              <span aria-hidden="true" className={styles.mark}>
                {c.change === 'added' ? '+' : '−'}
              </span>
              <span className={styles.diffText}>
                <span className="st-visually-hidden">{c.change === 'added' ? 'Added: ' : 'Removed: '}</span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>The methodology didn&apos;t change.</p>
      )}
      {comparison.sources_changed && <p className={styles.sourcesChanged}>The custodians or sites searched also changed.</p>}
      {comparison.unchanged.trim() && (
        <p className={styles.unchanged}>
          <span className={styles.muted}>Unchanged:</span> {comparison.unchanged}
        </p>
      )}
      <p className={styles.result}>{countChange(comparison.counts)}</p>
    </>
  );
}

export function CompareVersions({ matterId, versions }: { matterId: string; versions: Schemas['QueryVersion'][] }) {
  const pairs: Pair[] = versions.slice(1).map((v, i) => ({ from: versions[i]!.version, to: v.version }));
  const [chosenTo, setChosenTo] = useState<number | null>(null);
  // The newest pair until one is chosen (and again if the chosen one is no longer there).
  const pair = pairs.find((p) => p.to === chosenTo) ?? pairs[pairs.length - 1] ?? null;
  const comparison = useComparison(matterId, pair);

  return (
    <Card
      title="Compare versions"
      padding="lg"
      actions={pair && pairs.length > 0 ? <PairPicker pairs={pairs} value={pair} onChange={setChosenTo} /> : undefined}
    >
      {!pair ? (
        <EmptyState>
          {versions.length === 0
            ? 'There are no query versions to compare yet.'
            : 'There is only one query version so far. Change the search on the Scope tab and estimate it to compare two.'}
        </EmptyState>
      ) : comparison.isError ? (
        <ErrorNotice error={comparison.error} matterId={matterId} onRetry={() => void comparison.refetch()} headingLevel={3} />
      ) : comparison.data ? (
        <div className={styles.compareBody} aria-busy={comparison.isFetching}>
          <Comparison comparison={comparison.data} />
        </div>
      ) : (
        <p className={styles.muted}>Comparing v{pair.from} and v{pair.to}…</p>
      )}
    </Card>
  );
}
