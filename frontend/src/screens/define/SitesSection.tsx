// Sites without a custodian: shared team or department sites, added by address and removed one by one.
import { type FormEvent, useState } from 'react';
import type { Schemas } from '@/api/client';
import { Button, IconButton, InlineError } from '@/components';
import { ChangeError } from './errors';
import { normaliseSiteUrl, siteProblem } from './format';
import { useAddSite, useRemoveSite } from './hooks';
import styles from './DefineScreen.module.css';
import { CloseIcon, Section } from './Section';

export function SitesSection({ matter, existingSites }: { matter: Schemas['Matter']; existingSites: string[] }) {
  const add = useAddSite(matter.id);
  const remove = useRemoveSite(matter.id);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = normaliseSiteUrl(draft);
    if (!url) return;
    const why = siteProblem(url, existingSites);
    if (why) {
      setProblem(why);
      return;
    }
    add.mutate(url, { onSuccess: () => setDraft('') });
  };

  return (
    <Section title="Sites without a custodian" note="Shared team or department sites">
      {matter.sites.length > 0 && (
        <ul className={styles.siteList} aria-label="Sites without a custodian">
          {matter.sites.map((s) => (
            <li key={s.id} className={styles.site}>
              <span aria-hidden="true" className={styles.siteIcon}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
                  <path d="M2.5 6.5h11" />
                </svg>
              </span>
              <span className={styles.siteUrl}>{s.url}</span>
              <IconButton label={`Remove ${s.url}`} disabled={s.id.startsWith('adding:')} onClick={() => remove.mutate(s.id)}>
                <CloseIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <ChangeError error={remove.error} />
      <form className={styles.siteForm} onSubmit={submit} noValidate>
        <div className={styles.siteField}>
          <label htmlFor="site-url" className={styles.label}>
            Site address
          </label>
          <input
            id="site-url"
            type="url"
            className={styles.input}
            value={draft}
            placeholder="https://contoso.sharepoint.com/sites/Legal"
            aria-invalid={problem || add.isError ? true : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
              add.reset();
            }}
          />
        </div>
        <Button type="submit" disabled={add.isPending}>
          Add site
        </Button>
      </form>
      {problem ? <InlineError>{problem}</InlineError> : <ChangeError error={add.error} place="site" />}
    </Section>
  );
}
