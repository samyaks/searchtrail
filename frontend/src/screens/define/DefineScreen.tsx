// Define (docs/design/Define.dc.html): the matter's details, who and where is searched (custodians and their
// sources, linked sites, sites without a custodian), legal holds, and what that adds up to in Purview. The header
// and tabs above it are MatterLayout's; it reads the same matter, so a change here shows there.
import { useState } from 'react';
import { useParams } from 'react-router';
import type { Schemas } from '@/api/client';
import { useMe } from '@/api/queries';
import { Banner, ButtonLink } from '@/components';
import { CustodiansSection, type Unsaved } from './CustodiansSection';
import { DetailsSection } from './DetailsSection';
import { allSites, holdSummary, purviewCountText, searchedCounts, sourcesOf, type SearchedCounts, type Sources } from './format';
import { useChangeKind, useDefineMatter } from './hooks';
import styles from './DefineScreen.module.css';
import { CheckIcon, Section } from './Section';
import { SitesSection } from './SitesSection';

type Matter = Schemas['Matter'];

export function DefineScreen() {
  const { matterId = '' } = useParams();
  const matter = useDefineMatter(matterId);
  const me = useMe();
  const [unsaved, setUnsavedAll] = useState<Unsaved>({});
  const changeKind = useChangeKind(matter.data);

  // MatterLayout shows the error for a matter that can't be opened; while it loads, the header says so.
  if (!matter.data) return matter.isPending ? <p className={styles.muted}>Loading the matter…</p> : null;
  const m = matter.data;

  const setUnsaved = (userId: string, sources: Sources | null) =>
    setUnsavedAll((all) => {
      const next = { ...all };
      if (sources) next[userId] = sources;
      else delete next[userId];
      return next;
    });
  // Only custodians still on the matter count; an edit held for someone since removed is dropped.
  const shown = m.custodians.map((c) => unsaved[c.user_id] ?? sourcesOf(c));
  const existingSites = allSites(m);

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <DetailsSection key={m.id} matter={m} />
        <CustodiansSection matter={m} tenantName={me.data?.tenant.name} unsaved={unsaved} setUnsaved={setUnsaved} existingSites={existingSites} />
        <SitesSection matter={m} existingSites={existingSites} />
      </div>
      <div className={styles.aside}>
        <SearchedSection matter={m} counts={searchedCounts(shown, m.sites.length)} changeKind={changeKind} />
        <Section title="Legal holds">
          <p className={styles.strong}>{holdSummary(m.custodians)}</p>
          <p className={styles.small}>
            Holds are placed in Purview and keep content from being deleted while the matter is open. They don't change what's searched. SearchTrail logs who
            places or releases each one.
          </p>
        </Section>
        <Section title="Matter team">
          <ul className={styles.team}>
            <li>
              <span aria-hidden="true" className={styles.avatarInk}>
                {initials(m.created_by.display_name)}
              </span>
              <span className={styles.grow}>{m.created_by.display_name}</span>
              <span className={styles.muted}>Owner</span>
            </li>
          </ul>
          <p className={styles.small}>Team members need the eDiscovery Manager role in Purview.</p>
        </Section>
        <CaseSection matter={m} />
      </div>
    </div>
  );
}

const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '')).toUpperCase();
};

function SearchedSection({ matter, counts, changeKind }: { matter: Matter; counts: SearchedCounts; changeKind: 'sources' | 'search' | null }) {
  const current = matter.current_version;
  const tiles: [number, string][] = [
    [counts.mailboxes, 'Mailboxes, with Teams chats'],
    [counts.onedrives, 'OneDrive accounts'],
    [counts.sharepoint, 'SharePoint sites'],
  ];
  return (
    <Section title="What will be searched">
      <dl className={styles.counts}>
        {tiles.map(([n, label]) => (
          <div key={label} className={styles.countTile}>
            <dt className={styles.small}>{label}</dt>
            <dd className={styles.count}>{n}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.small}>{purviewCountText(counts)}</p>
      {current === null ? (
        <p className={styles.small}>Nothing has been sent to Purview yet. SearchTrail creates the Purview case the first time this matter is estimated.</p>
      ) : matter.draft_changed ? (
        <Banner title={changeKind === 'sources' ? 'Who is searched has changed.' : 'The search has changed.'}>
          {`SearchTrail will create search v${current + 1} in Purview. `}
          {matter.previewed_version !== null
            ? `The v${matter.previewed_version} preview no longer applies, so you'll need to preview again before exporting.`
            : 'Preview it before exporting.'}
        </Banner>
      ) : (
        <p className={styles.inStep}>
          <CheckIcon size={14} />
          In step with the Purview case
        </p>
      )}
      <ButtonLink variant="primary" to={`/matters/${encodeURIComponent(matter.id)}/scope`} className={styles.start}>
        Continue to Scope
      </ButtonLink>
    </Section>
  );
}

function CaseSection({ matter }: { matter: Matter }) {
  return (
    <Section title="Purview case">
      <span className="st-mono">{`${matter.matter_number} ${matter.name}`}</span>
      {matter.purview_case_id ? (
        <>
          <span className={styles.small}>Premium case · created by SearchTrail</span>
          <a href="https://purview.microsoft.com" className={styles.external} target="_blank" rel="noreferrer">
            Open in Purview
          </a>
        </>
      ) : (
        <span className={styles.small}>Not created yet. SearchTrail creates it the first time this matter is estimated.</span>
      )}
    </Section>
  );
}
