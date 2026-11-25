// Custodians: find people in the directory and add them, choose which of their sources are searched, link sites to
// them, and place or release their legal holds.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { Schemas } from '@/api/client';
import { Button, ChipList, IconButton, RemovableChip, Switch } from '@/components';
import { ChangeError, FieldError } from './errors';
import { describedBy, hasAnySource, holdSettling, holdText, normaliseSiteUrl, siteLabel, siteProblem, sourcesOf, type Sources } from './format';
import { MIN_SEARCH, useDirectorySearch, useRemoveCustodian, useSetHold, useUpsertCustodian } from './hooks';
import styles from './DefineScreen.module.css';
import { CheckIcon, CloseIcon, Section } from './Section';

type Matter = Schemas['Matter'];
type Custodian = Schemas['Custodian'];

/** Sources a person turned off without saving, because nothing would be left to search. */
export type Unsaved = Record<string, Sources>;

type Props = {
  matter: Matter;
  tenantName?: string;
  unsaved: Unsaved;
  setUnsaved: (userId: string, sources: Sources | null) => void;
  existingSites: string[];
};

export function CustodiansSection({ matter, tenantName, unsaved, setUnsaved, existingSites }: Props) {
  // A removal takes the row away at once, so whether it was refused is kept here, by person, and shown when the
  // row comes back. A removal that went through drops any sources held back for them, so adding them again starts
  // afresh.
  const [removeErrors, setRemoveErrors] = useState<Record<string, unknown>>({});
  const setRemoveError = (userId: string, error: unknown) =>
    setRemoveErrors((all) => {
      const next = { ...all };
      if (error) next[userId] = error;
      else delete next[userId];
      return next;
    });
  const remove = useRemoveCustodian(matter.id, {
    onMutate: (userId) => setRemoveError(userId, null),
    onSuccess: (userId) => setUnsaved(userId, null),
    onError: (error, userId) => setRemoveError(userId, error),
  });

  // Where focus goes once a removed row has gone: the next row's remove button, else the one before, else the heading.
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterRemove = useRef<{ removed: string; next: string | null } | null>(null);
  useEffect(() => {
    const pending = focusAfterRemove.current;
    if (!pending || matter.custodians.some((c) => c.user_id === pending.removed)) return;
    focusAfterRemove.current = null;
    const next = pending.next ? listRef.current?.querySelector<HTMLElement>(`[data-remove="${pending.next}"]`) : null;
    (next ?? headingRef.current)?.focus();
  }, [matter.custodians]);

  const removeCustodian = (userId: string) => {
    const others = matter.custodians.filter((c) => c.user_id !== userId);
    const at = matter.custodians.findIndex((c) => c.user_id === userId);
    focusAfterRemove.current = { removed: userId, next: (others[at] ?? others[at - 1])?.user_id ?? null };
    remove.mutate(userId);
  };

  return (
    <Section title="Custodians" note="People whose mailboxes, chats and files are searched" headingRef={headingRef}>
      <PeopleSearch matter={matter} tenantName={tenantName} />
      <ul className={styles.rows} aria-label="Custodians" ref={listRef}>
        {matter.custodians.map((c) => (
          <CustodianRow
            key={c.user_id}
            matterId={matter.id}
            custodian={c}
            shown={unsaved[c.user_id] ?? sourcesOf(c)}
            setUnsaved={(s) => setUnsaved(c.user_id, s)}
            existingSites={existingSites}
            onRemove={() => removeCustodian(c.user_id)}
            removeError={removeErrors[c.user_id]}
          />
        ))}
      </ul>
      {matter.custodians.length === 0 && <p className={styles.emptyRow}>No custodians yet. Add one above, or search sites only.</p>}
    </Section>
  );
}

function PeopleSearch({ matter, tenantName }: { matter: Matter; tenantName?: string }) {
  const [text, setText] = useState('');
  const search = useDirectorySearch(text);
  const add = useUpsertCustodian(matter.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = text.trim();
  const added = new Set(matter.custodians.map((c) => c.user_id));
  const people = (search.data?.items ?? []).filter((p) => !added.has(p.id));
  const waiting = trimmed.length >= MIN_SEARCH && (!search.settled || search.isFetching) && !search.isError;

  const addPerson = (p: Schemas['DirectoryUser']) => {
    const custodian: Custodian = { user_id: p.id, display_name: p.display_name, email: p.email, department: p.department, initials: p.initials, mailbox: true, onedrive: true, sites: [], hold: { status: 'off', since: null } };
    add.mutate({ custodian, sources: sourcesOf(custodian) });
    setText('');
    // The suggestion that had focus goes with the list; carry on from the search field.
    inputRef.current?.focus();
  };

  return (
    <div className={styles.field}>
      <label htmlFor="cust-search" className={styles.label}>
        {`Add a custodian from ${tenantName ? `${tenantName}'s` : 'the'} directory`}
      </label>
      <input
        id="cust-search"
        ref={inputRef}
        type="search"
        autoComplete="off"
        className={styles.input}
        value={text}
        placeholder="Name, email or department"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setText('')}
      />
      {trimmed && (
        <ul aria-label="Matching people" className={styles.suggestions} aria-busy={waiting}>
          {trimmed.length < MIN_SEARCH && <li className={styles.suggestionNote}>Keep typing: search needs at least two letters.</li>}
          {trimmed.length >= MIN_SEARCH && search.isError && (
            <li className={styles.suggestionNote}>
              <ChangeError error={search.error} />
              <Button size="sm" onClick={() => void search.refetch()}>
                Try again
              </Button>
            </li>
          )}
          {trimmed.length >= MIN_SEARCH &&
            !search.isError &&
            search.data &&
            people.map((p) => (
              <li key={p.id}>
                <button type="button" className={styles.suggestion} onClick={() => addPerson(p)}>
                  <span aria-hidden="true" className={styles.avatarSm}>
                    {p.initials}
                  </span>
                  <span className={styles.person}>
                    <span className={styles.personName}>{p.display_name}</span>
                    <span className={styles.muted}>{[p.email, p.department].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={styles.addWord}>Add</span>
                </button>
              </li>
            ))}
          {trimmed.length >= MIN_SEARCH && !search.isError && !waiting && search.data && people.length === 0 && (
            <li className={styles.suggestionNote}>No one in the directory matches. Check the spelling, or add a site instead.</li>
          )}
          {waiting && people.length === 0 && <li className={styles.suggestionNote}>Searching…</li>}
        </ul>
      )}
      <ChangeError error={add.error} />
    </div>
  );
}

const SOURCE_LABELS = [
  ['mailbox', 'Mailbox and Teams chats'],
  ['onedrive', 'OneDrive'],
] as const;

type RowProps = {
  matterId: string;
  custodian: Custodian;
  shown: Sources;
  setUnsaved: (sources: Sources | null) => void;
  existingSites: string[];
  onRemove: () => void;
  removeError: unknown;
};

function CustodianRow({ matterId, custodian: c, shown, setUnsaved, existingSites, onRemove, removeError }: RowProps) {
  const upsert = useUpsertCustodian(matterId);
  const hold = useSetHold(matterId, c.user_id);
  const [linking, setLinking] = useState(false);
  // Closing the link form puts focus back on "Link a site", which comes back with it.
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const refocusLink = useRef(false);
  useEffect(() => {
    if (linking || !refocusLink.current) return;
    refocusLink.current = false;
    linkButtonRef.current?.focus();
  }, [linking]);
  const closeLinkForm = () => {
    refocusLink.current = true;
    setLinking(false);
  };

  /** Save the new sources, or hold them here if nothing would be left to search (the API needs one). */
  const change = (next: Sources) => {
    if (!hasAnySource(next)) {
      setUnsaved(next);
      return;
    }
    setUnsaved(null);
    upsert.mutate({ custodian: c, sources: next });
  };

  const settling = holdSettling(c.hold);
  const holdOn = c.hold.status === 'on' || c.hold.status === 'pending';

  return (
    <li className={styles.custodian}>
      <div className={styles.custodianTop}>
        <span aria-hidden="true" className={styles.avatar}>
          {c.initials}
        </span>
        <span className={styles.person}>
          <span className={styles.personName}>{c.display_name}</span>
          <span className={styles.muted}>{[c.email, c.department].filter(Boolean).join(' · ')}</span>
        </span>
        <IconButton label={`Remove ${c.display_name}`} data-remove={c.user_id} onClick={onRemove}>
          <CloseIcon />
        </IconButton>
      </div>

      <div className={styles.custodianControls}>
        <div role="group" aria-label={`Sources to search for ${c.display_name}`} className={styles.sources}>
          {SOURCE_LABELS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={shown[key]} className={styles.source} onClick={() => change({ ...shown, [key]: !shown[key] })}>
              {shown[key] && <CheckIcon />}
              {label}
            </button>
          ))}
        </div>
        <div className={styles.hold}>
          <span className={styles.muted} aria-live="polite">
            {holdText(c.hold)}
          </span>
          <Switch
            label={`Legal hold for ${c.display_name}`}
            hideLabel
            checked={holdOn}
            disabled={settling || hold.isPending}
            onChange={(on) => hold.mutate(on)}
          />
        </div>
      </div>

      <div className={styles.linked}>
        <span className={styles.muted}>Linked sites:</span>
        {shown.sites.length === 0 ? (
          <span>None</span>
        ) : (
          <ChipList label={`Sites linked to ${c.display_name}`}>
            {shown.sites.map((url) => (
              <RemovableChip key={url} removeLabel={`Unlink ${siteLabel(url)} from ${c.display_name}`} onRemove={() => change({ ...shown, sites: shown.sites.filter((u) => u !== url) })}>
                <span title={url}>{siteLabel(url)}</span>
              </RemovableChip>
            ))}
          </ChipList>
        )}
        {!linking && (
          <button type="button" ref={linkButtonRef} className={styles.linkSite} onClick={() => setLinking(true)}>
            Link a site
          </button>
        )}
      </div>
      {linking && (
        <LinkSiteForm
          name={c.display_name}
          existingSites={existingSites}
          onCancel={closeLinkForm}
          onLink={(url) => {
            change({ ...shown, sites: [...shown.sites, url] });
            closeLinkForm();
          }}
        />
      )}

      {!hasAnySource(shown) && (
        <p role="alert" className={styles.rowAlert}>
          Nothing selected for {c.display_name}. Choose at least one source, or remove them.
        </p>
      )}
      {c.hold.status === 'failed' && (
        <p role="alert" className={styles.rowAlert}>
          Purview reported that the hold change for {c.display_name} failed. Turn the hold on to try again, or check the case in the Purview portal.
        </p>
      )}
      <div className={styles.rowErrors}>
        <ChangeError error={upsert.error} />
        <ChangeError error={removeError} />
        <ChangeError error={hold.error} />
      </div>
    </li>
  );
}

function LinkSiteForm({ name, existingSites, onLink, onCancel }: { name: string; existingSites: string[]; onLink: (url: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const errorId = `${id}-error`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = normaliseSiteUrl(draft);
    if (!url) return;
    const why = siteProblem(url, existingSites);
    if (why) setProblem(why);
    else onLink(url);
  };
  return (
    <form className={styles.linkForm} onSubmit={submit} noValidate>
      <div className={styles.siteField}>
        <label htmlFor={id} className={styles.label}>
          {`Site address to link to ${name}`}
        </label>
        <input
          id={id}
          type="url"
          className={styles.input}
          value={draft}
          autoFocus
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy(!!problem && errorId)}
          placeholder="https://contoso.sharepoint.com/sites/ProjectFalcon"
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        />
      </div>
      <Button size="sm" type="submit">
        Link
      </Button>
      <Button size="sm" variant="neutral" onClick={onCancel}>
        Cancel
      </Button>
      {problem && (
        <div className={styles.fullWidth}>
          <FieldError id={errorId}>{problem}</FieldError>
        </div>
      )}
    </form>
  );
}
