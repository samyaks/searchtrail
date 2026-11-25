// The filter builder: the left column of docs/design/Scope.dc.html.
import { useState } from 'react';
import type { Schemas } from '@/api/client';
import { ButtonLink, ChipList, ErrorNotice, InlineError, RemovableChip, SegmentedControl } from '@/components';
import { AddForm } from './AddForm';
import {
  checkDomain,
  checkExtension,
  checkTerm,
  displayTerm,
  KINDS,
  labelRows,
  sourcesSummary,
  toggleKind,
  withLabelState,
  type Criteria,
  type LabelState,
} from './criteria';
import { useLabels } from './hooks';
import styles from './ScopeScreen.module.css';

export type SectionProps = {
  criteria: Criteria;
  onChange: (next: Criteria) => void;
  /** The API's criteria_invalid message, when it is about a field in this section. */
  problem?: string | null;
};

const without = (list: readonly string[], value: string) => list.filter((x) => x !== value);

function Scope({ children }: { children: string }) {
  return <span className={styles.scopeTag}>{children}</span>;
}

/** Whose data is searched, from Define. */
export function WhoCard({ matter }: { matter: Schemas['Matter'] }) {
  const { title, detail } = sourcesSummary(matter);
  return (
    <section aria-labelledby="who-h" className={`${styles.panel} ${styles.who}`}>
      <div className={styles.whoText}>
        <h2 id="who-h" className={styles.h2}>
          {title}
        </h2>
        <span className={styles.muted13}>{detail}</span>
      </div>
      <ButtonLink to={`/matters/${encodeURIComponent(matter.id)}/define`} className={styles.whoLink}>
        Edit in Define
      </ButtonLink>
    </section>
  );
}

export function TermsSection({ criteria, onChange, problem }: SectionProps) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="terms-h" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="terms-h" className={styles.h2}>
          Search terms
        </h2>
        <Scope>All items</Scope>
      </div>
      <div className={styles.row}>
        <span className={styles.muted14}>Find items containing</span>
        <SegmentedControl
          label="Match"
          options={[
            { value: 'any', label: 'Any term' },
            { value: 'all', label: 'All terms' },
          ]}
          value={criteria.keyword_mode}
          onChange={(keyword_mode) => onChange({ ...criteria, keyword_mode })}
        />
      </div>
      {criteria.keywords.length > 0 ? (
        <ChipList label="Search terms">
          {criteria.keywords.map((t) => (
            <RemovableChip key={t} tone="term" removeLabel={`Remove ${t}`} onRemove={() => onChange({ ...criteria, keywords: without(criteria.keywords, t) })}>
              {displayTerm(t)}
            </RemovableChip>
          ))}
        </ChipList>
      ) : (
        <p className={styles.muted14}>No search terms yet. Add at least one to find items.</p>
      )}
      <AddForm
        label="Add a term or phrase"
        button="Add term"
        placeholder="brightline"
        mono
        check={(typed) => checkTerm(typed, criteria.keywords)}
        onAdd={(term) => onChange({ ...criteria, keywords: [...criteria.keywords, term] })}
      />
      {problem && <InlineError>{problem}</InlineError>}
      <p className={styles.hint}>Put * at the end of a word to match its variants, like invoic*. Phrases are matched exactly.</p>

      <div className={styles.subsection}>
        <span className={styles.subhead} id="exclusions-h">
          Leave out items containing
        </span>
        <ChipList label="Exclusion terms">
          {criteria.exclude_keywords.map((t) => (
            <RemovableChip
              key={t}
              tone="exclude"
              removeLabel={`Stop excluding ${t}`}
              onRemove={() => onChange({ ...criteria, exclude_keywords: without(criteria.exclude_keywords, t) })}
            >
              {displayTerm(t)}
            </RemovableChip>
          ))}
          {!adding && (
            <li>
              <button type="button" className={styles.dashedButton} onClick={() => setAdding(true)}>
                Add exclusion
              </button>
            </li>
          )}
        </ChipList>
        {adding && (
          <AddForm
            label="Leave out a term or phrase"
            button="Add exclusion"
            placeholder="weekly digest"
            mono
            autoFocus
            check={(typed) => checkTerm(typed, criteria.exclude_keywords)}
            onAdd={(term) => {
              onChange({ ...criteria, exclude_keywords: [...criteria.exclude_keywords, term] });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
    </section>
  );
}

export function WhenSection({ criteria, onChange, problem, typesProblem }: SectionProps & { typesProblem?: string | null }) {
  const [lastKindNote, setLastKindNote] = useState(false);
  const docsOn = criteria.kinds.includes('docs');
  const messagesOn = criteria.kinds.includes('email') || criteria.kinds.includes('chats');
  const backwards = Boolean(criteria.date_from && criteria.date_to && criteria.date_from > criteria.date_to);
  return (
    <section aria-labelledby="when-h" className={styles.panel} data-gap="lg">
      <h2 id="when-h" className={styles.h2}>
        Dates and item types
      </h2>
      <div className={styles.dates}>
        <div className={styles.field}>
          <label htmlFor="date-from" className={styles.fieldLabel}>
            From
          </label>
          <input
            id="date-from"
            type="date"
            className={styles.input}
            value={criteria.date_from ?? ''}
            onChange={(e) => onChange({ ...criteria, date_from: e.target.value || null })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="date-to" className={styles.fieldLabel}>
            To (inclusive)
          </label>
          <input
            id="date-to"
            type="date"
            className={styles.input}
            value={criteria.date_to ?? ''}
            onChange={(e) => onChange({ ...criteria, date_to: e.target.value || null })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="doc-date" className={styles.fieldLabel}>
            Date documents by
          </label>
          <select
            id="doc-date"
            className={styles.input}
            value={criteria.doc_date_property}
            onChange={(e) => onChange({ ...criteria, doc_date_property: e.target.value as Criteria['doc_date_property'] })}
          >
            <option value="lastmodifiedtime">Last modified</option>
            <option value="created">Created</option>
          </select>
        </div>
      </div>
      {backwards && <InlineError>The From date is after the To date, so nothing can match. Swap them or change one.</InlineError>}
      {problem && <InlineError>{problem}</InlineError>}
      <p className={styles.hint}>Emails and chats are dated by when they were sent or received.</p>

      <div className={styles.stack8}>
        <span className={styles.subhead}>Item types</span>
        <div role="group" aria-label="Item types" className={styles.kinds}>
          {KINDS.map(({ kind, label }) => {
            const on = criteria.kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                className={styles.kind}
                aria-pressed={on}
                onClick={() => {
                  const kinds = toggleKind(criteria.kinds, kind);
                  setLastKindNote(kinds === null);
                  if (kinds) onChange({ ...criteria, kinds });
                }}
              >
                {on && (
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 7.5l3 3 6-7" />
                  </svg>
                )}
                {label}
              </button>
            );
          })}
        </div>
        {lastKindNote && (
          <p role="status" className={styles.hint}>
            Keep at least one item type. Turn another on first.
          </p>
        )}
      </div>

      <div className={styles.twoUp}>
        <div className={styles.stack8}>
          <div className={styles.row8}>
            <span className={styles.subhead}>File types</span>
            <Scope>Documents only</Scope>
          </div>
          {docsOn ? (
            <>
              {criteria.file_extensions.length > 0 ? (
                <ChipList label="File types">
                  {criteria.file_extensions.map((e) => (
                    <RemovableChip key={e} removeLabel={`Remove ${e}`} onRemove={() => onChange({ ...criteria, file_extensions: without(criteria.file_extensions, e) })}>
                      {e}
                    </RemovableChip>
                  ))}
                </ChipList>
              ) : (
                <p className={styles.hint}>Documents of any file type.</p>
              )}
              <AddForm
                label="Add a file type"
                button="Add"
                placeholder="msg"
                size="sm"
                check={(typed) => checkExtension(typed, criteria.file_extensions)}
                onAdd={(ext) => onChange({ ...criteria, file_extensions: [...criteria.file_extensions, ext] })}
              />
            </>
          ) : (
            <p className={styles.hint}>Turn on Documents to limit file types.</p>
          )}
        </div>
        <div className={styles.stack8}>
          <div className={styles.row8}>
            <span className={styles.subhead}>Leave out participants at</span>
            <Scope>Emails and chats only</Scope>
          </div>
          {messagesOn ? (
            <>
              {criteria.participant_domains.length > 0 && (
                // The criteria can also keep only some domains. This screen doesn't add them, but shows any the draft has.
                <ChipList label="Only participants at">
                  {criteria.participant_domains.map((d) => (
                    <RemovableChip key={d} removeLabel={`Stop limiting to ${d}`} onRemove={() => onChange({ ...criteria, participant_domains: without(criteria.participant_domains, d) })}>
                      only {d}
                    </RemovableChip>
                  ))}
                </ChipList>
              )}
              {criteria.exclude_participant_domains.length > 0 && (
                <ChipList label="Excluded domains">
                  {criteria.exclude_participant_domains.map((d) => (
                    <RemovableChip
                      key={d}
                      removeLabel={`Stop excluding ${d}`}
                      onRemove={() => onChange({ ...criteria, exclude_participant_domains: without(criteria.exclude_participant_domains, d) })}
                    >
                      {d}
                    </RemovableChip>
                  ))}
                </ChipList>
              )}
              <AddForm
                label="Add a domain"
                button="Add"
                placeholder="newsletters.contoso.com"
                size="sm"
                check={(typed) => checkDomain(typed, criteria.exclude_participant_domains)}
                onAdd={(domain) => onChange({ ...criteria, exclude_participant_domains: [...criteria.exclude_participant_domains, domain] })}
              />
            </>
          ) : (
            <p className={styles.hint}>Turn on Emails or Teams chats to filter by domain.</p>
          )}
        </div>
      </div>
      {typesProblem && <InlineError>{typesProblem}</InlineError>}
    </section>
  );
}

const LABEL_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'only', label: 'Only', tone: 'only' },
  { value: 'exclude', label: 'Exclude', tone: 'exclude' },
] as const;

export function LabelsSection({ criteria, onChange, problem }: SectionProps) {
  const labels = useLabels();
  const rows = labels.data ? labelRows(labels.data.items, criteria) : [];
  const anyOnly = rows.some((r) => r.state === 'only') || criteria.label_ids.length > 0;
  return (
    <section aria-labelledby="labels-h" className={styles.panel} data-gap="sm">
      <div className={styles.panelHead}>
        <h2 id="labels-h" className={styles.h2}>
          Sensitivity labels
        </h2>
        <Scope>All items</Scope>
      </div>
      {labels.isPending && <p className={styles.muted14}>Loading the labels…</p>}
      {labels.isError && <ErrorNotice error={labels.error} onRetry={() => void labels.refetch()} headingLevel={3} />}
      {labels.data && rows.length === 0 && <p className={styles.muted14}>This tenant has no sensitivity labels.</p>}
      {rows.length > 0 && (
        <div className={styles.labelRows}>
          {rows.map((row) => (
            <div key={row.id} className={styles.labelRow}>
              <span className={styles.labelName}>
                <span className={styles.strong}>{row.name}</span>
                {row.note && <span className={styles.muted13}>{row.note}</span>}
              </span>
              <SegmentedControl<LabelState>
                label={`Filter for ${row.name}`}
                options={LABEL_OPTIONS}
                value={row.state}
                onChange={(state) => onChange(withLabelState(criteria, row.id, state))}
              />
            </div>
          ))}
        </div>
      )}
      {anyOnly && (
        <p className={styles.onlyNote}>Items without a sensitivity label are left out, because you chose Only for at least one label.</p>
      )}
      {problem && <InlineError>{problem}</InlineError>}
    </section>
  );
}

export function ExpertSection({ criteria, onChange, problem }: SectionProps) {
  const [text, setText] = useState(criteria.raw_kql ?? '');
  const [open, setOpen] = useState(Boolean(criteria.raw_kql));
  return (
    <details className={styles.expert} open={open || Boolean(problem)} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.expertSummary}>Expert KQL</summary>
      <div className={styles.expertBody}>
        <label htmlFor="raw-kql" className={styles.fieldLabel}>
          Extra query, added with AND
        </label>
        <textarea
          id="raw-kql"
          rows={3}
          className={styles.textarea}
          placeholder="hasattachment:true"
          value={text}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onChange({ ...criteria, raw_kql: e.target.value.trim() ? e.target.value : null });
          }}
        />
        {problem && <InlineError>{problem}</InlineError>}
      </div>
    </details>
  );
}
