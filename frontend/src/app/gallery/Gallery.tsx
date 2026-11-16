// The component gallery (/_gallery, development only): every component of src/components in every state, on
// one page, so a screen's author can see what exists and a reviewer can check a component against the design.
// It runs against nothing: all the data here is made up. Add a component to the kit, add it here.
import { type ReactNode, useState } from 'react';
import { ERROR_CODES } from '@/api/errors';
import { ApiRequestError } from '@/api/client';
import {
  Banner,
  BarBreakdown,
  Button,
  ButtonLink,
  Card,
  ChipList,
  CountTile,
  DataTable,
  EmptyState,
  ErrorNotice,
  FilterChip,
  IconButton,
  InlineError,
  MethodologyCard,
  MonthChart,
  Pill,
  RemovableChip,
  SegmentedControl,
  Switch,
  TileGrid,
  type PillTone,
} from '@/components';
import styles from './Gallery.module.css';

const MONTHS = [39, 39, 31, 32, 40, 49, 35, 36, 50, 36, 36, 36, 28, 31, 38, 39, 29, 31].map((count, i) => ({
  month: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
  count,
}));
const BY_LOCATION = [
  { key: 'alex', label: 'Alex Wilber', count: 312 },
  { key: 'megan', label: 'Megan Bowen', count: 281 },
  { key: 'finance', label: 'sites/Finance', count: 62 },
];
const BY_LABEL = [
  { key: 'general', label: 'General', count: 137 },
  { key: 'high', label: 'Highly Confidential', count: 136 },
  { key: 'finance', label: 'Confidential/Finance', count: 133 },
  { key: 'none', label: 'No label', count: 119, quiet: true },
];
const METHODOLOGY = [
  'Item types: emails, Teams chats, documents.',
  'Date range from 2024-01-01 to 2025-06-30 (inclusive): emails/chats by sent or received date; documents by last modified date.',
  'Containing ANY of these terms: "project falcon", invoic*, kickback, "side letter".',
  'Terms ending in * match any word starting with that stem.',
  'Excluding items containing any of: "weekly digest".',
  'Documents limited to file types: docx, xlsx, pptx, pdf.',
];
const TERMS = ['"project falcon"', 'invoic*', 'kickback', '"side letter"'];
const PILL_TONES: PillTone[] = ['neutral', 'outline', 'highlight', 'ink', 'ok', 'danger', 'draft'];
const ROWS = [
  { id: 'a', name: 'Project Falcon investigation', stage: 'Previewed', custodians: 2 },
  { id: 'b', name: 'Harlow v. Contoso (employment)', stage: 'Scoping', custodians: 5 },
];
const apiError = (code: string, message: string) => new ApiRequestError(400, { code, message, details: {} } as never);

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {note && <p className={styles.note}>{note}</p>}
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen}>
      <span className={styles.label}>{label}</span>
      <div className={styles.stage}>{children}</div>
    </div>
  );
}

const Plus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export function Gallery() {
  const [term, setTerm] = useState<'any' | 'all'>('any');
  const [label, setLabel] = useState<'any' | 'only' | 'exclude'>('any');
  const [bar, setBar] = useState<string | null>('high');
  const [on, setOn] = useState(true);
  const [pressed, setPressed] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const chips = ['"project falcon"', 'invoic*', 'kickback'].filter((c) => !removed.includes(c));

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.title}>Component gallery</h1>
        <p className={styles.note}>
          Every component in <code>src/components</code>, in every state, with made-up data. Development only: it is not in the
          production build.
        </p>
      </header>

      <Section id="g-buttons" title="Buttons" note="Primary is the main action on a screen (one per view); highlight is the next step. md is 44px, sm is 36px.">
        <Specimen label="Variants, md">
          {(['primary', 'secondary', 'neutral', 'highlight', 'danger'] as const).map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </Specimen>
        <Specimen label="Variants, sm">
          {(['primary', 'secondary', 'neutral', 'highlight', 'danger'] as const).map((variant) => (
            <Button key={variant} variant={variant} size="sm">
              {variant}
            </Button>
          ))}
        </Specimen>
        <Specimen label="With an icon, disabled, a link that looks like a button, an icon only">
          <Button variant="primary" icon={<Plus />}>
            New matter
          </Button>
          <Button disabled>Start export</Button>
          <ButtonLink to="/matters" variant="secondary">
            Back to Matters
          </ButtonLink>
          <IconButton label="Remove Alex Wilber">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </IconButton>
        </Specimen>
      </Section>

      <Section id="g-chips" title="Chips and pills">
        <Specimen label="Filter chips: off with a count, on, disabled">
          <FilterChip pressed={pressed} count={3} onClick={() => setPressed((p) => !p)}>
            Previewed
          </FilterChip>
          <FilterChip pressed count={5}>
            All
          </FilterChip>
          <FilterChip pressed={false} disabled>
            Exported
          </FilterChip>
        </Specimen>
        <Specimen label="Pills: the text carries the meaning, the tone is extra">
          {PILL_TONES.map((tone) => (
            <Pill key={tone} tone={tone}>
              {tone}
            </Pill>
          ))}
        </Specimen>
        <Specimen label="Removable chips: a term, an exclusion, a file type">
          <ChipList label="Search terms">
            {chips.map((chip) => (
              <RemovableChip key={chip} tone="term" removeLabel={`Remove ${chip}`} onRemove={() => setRemoved((r) => [...r, chip])}>
                {chip}
              </RemovableChip>
            ))}
            <RemovableChip tone="exclude" removeLabel='Remove "weekly digest"' onRemove={() => {}}>
              "weekly digest"
            </RemovableChip>
            <RemovableChip removeLabel="Remove docx" onRemove={() => {}}>
              docx
            </RemovableChip>
          </ChipList>
        </Specimen>
      </Section>

      <Section id="g-controls" title="Segmented controls and switches">
        <Specimen label="Two segments (Any term, All terms)">
          <SegmentedControl
            label="Match"
            value={term}
            onChange={setTerm}
            options={[
              { value: 'any', label: 'Any term' },
              { value: 'all', label: 'All terms' },
            ]}
          />
        </Specimen>
        <Specimen label="Three segments with tones (Any, Only in the highlighter, Exclude in red)">
          <SegmentedControl
            label="Public"
            value={label}
            onChange={setLabel}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'only', label: 'Only', tone: 'only' },
              { value: 'exclude', label: 'Exclude', tone: 'exclude' },
            ]}
          />
        </Specimen>
        <Specimen label="Switches: on, off, disabled, label hidden">
          <Switch label="Include partially indexed items" checked={on} onChange={setOn} />
          <Switch label="Include files linked in emails" checked={false} onChange={() => {}} />
          <Switch label="Teams conversations as transcripts" checked disabled onChange={() => {}} />
          <Switch label="Not on hold" checked={false} hideLabel onChange={() => {}} />
        </Specimen>
      </Section>

      <Section id="g-containers" title="Cards and tables">
        <Specimen label="Card: with a title and an action; padding md, lg, none">
          <Card title="Matter details" headingLevel={3} actions={<Button size="sm">Edit</Button>}>
            A white panel with a thin border.
          </Card>
          <Card title="Roomier" headingLevel={3} padding="lg">
            Padding lg.
          </Card>
          <Card title="Edge to edge" headingLevel={3} padding="none">
            <EmptyState>Padding none lets a table or list reach the card's edges.</EmptyState>
          </Card>
        </Specimen>
        <Specimen label="Data table: with a selected row, and empty">
          <DataTable
            caption="Matters"
            rowKey={(row) => row.id}
            selectedKey="a"
            rows={ROWS}
            columns={[
              { key: 'name', header: 'Matter', cell: (row) => row.name, rowHeader: true },
              { key: 'stage', header: 'Stage', cell: (row) => row.stage },
              { key: 'custodians', header: 'Custodians', cell: (row) => row.custodians, numeric: true },
            ]}
          />
          <DataTable
            caption="No matters"
            rowKey={() => ''}
            rows={[]}
            columns={[{ key: 'name', header: 'Matter', cell: () => '' }]}
            emptyMessage="No matters match. Clear the search or choose All."
          />
        </Specimen>
      </Section>

      <Section id="g-data" title="Counts, breakdowns and the month chart" note="The Preview screen. Choosing a bar filters; choosing it again clears the filter.">
        <Specimen label="Count tiles: a size, a green note, a plain note, text instead of a number">
          <TileGrid>
            <CountTile label="Items matching" value={630} note="29.0 MB" />
            <CountTile label="Partially indexed" value={25} note="21.7 MB · included in export" noteTone="ok" />
            <CountTile label="Encrypted" value={69} note="Reviewers may not be able to open these" />
            <CountTile label="Size" value="50.7 MB" note="2 mailboxes, 4 sites" />
          </TileGrid>
        </Specimen>
        <Specimen label="Bar breakdowns: a filter on (the chosen bar), and one that is only a picture">
          <div className={styles.three}>
            <BarBreakdown title="By custodian or site" bars={BY_LOCATION} selectedKey={bar} onSelect={setBar} />
            <BarBreakdown title="By sensitivity label" bars={BY_LABEL} selectedKey={bar} onSelect={setBar} />
            <BarBreakdown title="By type (not a filter)" bars={BY_LOCATION.slice(0, 2)} />
          </div>
        </Specimen>
        <Specimen label="Empty breakdown">
          <BarBreakdown title="By label" bars={[]} />
        </Specimen>
        <Specimen label="Month chart: the busiest month is black; a sentence and a hidden table serve a screen reader">
          <MonthChart title="By month" months={MONTHS} headingLevel={3} note="Jan 2024 to Jun 2025, the date range in the query" />
        </Specimen>
        <Specimen label="Month chart with nothing to chart">
          <MonthChart title="By month, with no dated items" months={[]} headingLevel={3} />
        </Specimen>
      </Section>

      <Section id="g-method" title="Methodology card" note="Pleading paper: the text that goes into the log and the export. The search terms are marked.">
        <Specimen label="With its title page">
          <MethodologyCard heading={{ matter: 'M-2026-0142', version: 'Query v3' }} lines={METHODOLOGY} terms={TERMS} />
        </Specimen>
        <Specimen label="Without (under a heading of its own)">
          <MethodologyCard lines={METHODOLOGY.slice(0, 3)} terms={TERMS} />
        </Specimen>
      </Section>

      <Section id="g-messages" title="Banners, errors and empty states">
        <Specimen label="Notice: something changed, with an action">
          <Banner
            title="You changed the query."
            actions={
              <Button variant="primary" size="sm">
                Estimate v4
              </Button>
            }
          >
            These counts are still for v3. Estimate again to see the effect.
          </Banner>
        </Specimen>
        <Specimen label="Notice, no action">
          <Banner title="Who is searched has changed.">The v3 preview no longer applies, so you'll need to preview again before exporting.</Banner>
        </Specimen>
        <Specimen label="Warning: a choice to be sure of">
          <Banner tone="warning">You're leaving out 25 items that couldn't be keyword-searched. Agree this with counsel; the choice is recorded in the log.</Banner>
        </Specimen>
        <Specimen label="Inline error, under a field">
          <InlineError>Enter a term or a phrase.</InlineError>
        </Specimen>
        <Specimen label="Empty states: a list with a way out, and a whole screen">
          <EmptyState>No matters match. Clear the search or choose All.</EmptyState>
          <EmptyState
            title="No matters yet"
            action={
              <Button variant="primary" icon={<Plus />}>
                New matter
              </Button>
            }
          >
            A matter is a Purview eDiscovery case that SearchTrail keeps in step with your search decisions.
          </EmptyState>
        </Specimen>
        <Specimen label="Errors, one for each code the API can return (src/api/errors.ts): blocked, transient and error">
          <div className={styles.errors}>
            {ERROR_CODES.map((code) => (
              <ErrorNotice key={code} error={apiError(code, '')} matterId="mat_falcon" onRetry={() => {}} headingLevel={3} />
            ))}
            <ErrorNotice error={new TypeError('Failed to fetch')} onRetry={() => {}} headingLevel={3} />
          </div>
        </Specimen>
      </Section>
    </main>
  );
}
