// What the package will hold, and the Purview export settings that shape it.
import type { Schemas } from '@/api/client';
import { Banner, Card, CountTile, SegmentedControl, Switch, TileGrid } from '@/components';
import styles from './ExportScreen.module.css';
import { exportTotals, n, sizeText, sourcesText } from './format';

type Options = Schemas['ExportOptions'];


export function WhatCard({ counts, options }: { counts: Schemas['Counts'] | null | undefined; options: Options }) {
  const totals = counts ? exportTotals(counts, options.include_partially_indexed) : null;
  return (
    <Card title="What will be exported" padding="lg">
      {counts && totals ? (
        <>
          <TileGrid>
            <CountTile label="Items" value={totals.items} note={totals.note} />
            <CountTile label="Size" value={sizeText(totals.bytes)} note={sourcesText(counts)} />
          </TileGrid>
          {!options.include_partially_indexed && counts.partial_items > 0 && (
            <Banner tone="warning">
              You're leaving out {n(counts.partial_items)} {counts.partial_items === 1 ? 'item' : 'items'} that couldn't be keyword-searched. Agree this
              with counsel; the choice is recorded in the log.
            </Banner>
          )}
        </>
      ) : (
        <p className={styles.muted}>The counts appear here once the checks have run on a previewed query.</p>
      )}
    </Card>
  );
}

type SwitchRow = { key: 'include_partially_indexed' | 'include_cloud_attachments' | 'teams_transcripts'; label: string; note: string };

export function OptionsCard({ counts, options, onChange }: { counts: Schemas['Counts'] | null | undefined; options: Options; onChange: (options: Options) => void }) {
  const partial = counts?.partial_items;
  const rows: SwitchRow[] = [
    {
      key: 'include_partially_indexed',
      label: 'Include partially indexed items',
      note: `${partial === undefined ? 'Items' : `${n(partial)} ${partial === 1 ? 'item' : 'items'}`} Purview could not keyword-search, such as encrypted or oversized files`,
    },
    { key: 'include_cloud_attachments', label: 'Include files linked in emails', note: 'Collects the current version of OneDrive and SharePoint files shared as links' },
    { key: 'teams_transcripts', label: 'Teams conversations as transcripts', note: 'Adds a readable HTML transcript for each chat thread' },
  ];
  return (
    <Card title="Options" padding="lg">
      <div className={styles.options}>
        {rows.map((row) => (
          <div key={row.key} className={styles.option}>
            <span className={styles.optionText}>
              <span className={styles.optionLabel} aria-hidden="true">
                {row.label}
              </span>
              <span className={styles.note}>{row.note}</span>
            </span>
            <Switch label={row.label} hideLabel checked={Boolean(options[row.key])} onChange={(checked) => onChange({ ...options, [row.key]: checked })} />
          </div>
        ))}
        <div className={styles.option} data-last="">
          <span className={styles.optionText}>
            <span className={styles.optionLabel}>Format for emails and chats</span>
            <span className={styles.note}>PST keeps mailbox folders together. Check what your Everlaw project expects.</span>
          </span>
          <SegmentedControl
            label="Format for emails and chats"
            options={[
              { value: 'pst', label: 'PST' },
              { value: 'msg', label: 'MSG' },
            ]}
            value={options.format}
            onChange={(format) => onChange({ ...options, format })}
          />
        </div>
      </div>
    </Card>
  );
}
