// The app shell: side navigation (the tenant, the way in to Matters, the person) and the main area.
// Matches docs/design/Main.dc.html, except that it shows only what V1 has: the design's Connections,
// Team and roles, and Help links, and the licence line, have no page or no data behind them yet.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import type { Schemas } from '@/api/client';
import { useMe } from '@/api/queries';
import { isSessionExpired, signIn, useSessionEnded } from '@/api/session';
import { Button } from '@/components';
import styles from './Shell.module.css';

const CLOUDS: Record<Schemas['Cloud'], string | null> = {
  commercial: null,
  gcc: 'Microsoft 365 GCC',
  gcc_high: 'Microsoft 365 GCC High',
  dod: 'Microsoft 365 DoD',
};

function TenantCard({ me }: { me: ReturnType<typeof useMe> }) {
  if (me.isPending) {
    return (
      <div className={styles.tenant} aria-busy="true">
        <span className={styles.tenantName}>Connecting…</span>
      </div>
    );
  }
  if (me.isError && isSessionExpired(me.error)) {
    return (
      <div className={styles.tenant}>
        <span className={styles.tenantName}>Signed out</span>
        <span className={styles.tenantLine}>Your session has ended.</span>
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className={styles.tenant}>
        <span className={styles.tenantName}>Not connected</span>
        <span className={styles.tenantLine}>SearchTrail's server isn't answering.</span>
      </div>
    );
  }
  const { tenant, dry_run: dryRun, cloud } = me.data;
  return (
    <div className={styles.tenant}>
      <span className={styles.tenantName}>{tenant.name}</span>
      <span className={styles.tenantLine}>
        <span aria-hidden="true" className={styles.dot} data-state={dryRun ? 'dry-run' : 'connected'} />
        {dryRun ? 'Dry run (no tenant contacted)' : 'Microsoft 365 connected'}
      </span>
      {CLOUDS[cloud] && <span className={styles.tenantLine}>{CLOUDS[cloud]}</span>}
    </div>
  );
}

/**
 * Shown in place of the page once any request finds the session ended. The page stays loaded underneath (hidden),
 * so a sign-in that comes back to it in place (the mocks) finds it as it was. Focus moves here, since what had focus
 * is now hidden.
 */
function SessionEnded() {
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    // No role="alert": focus moves to the heading, which reads it out; an alert as well would read it twice.
    <section aria-labelledby="session-ended" className={styles.sessionEnded}>
      <h1 id="session-ended" ref={heading} tabIndex={-1}>
        Your session has ended
      </h1>
      <p>Sign in again with your Microsoft account to carry on. You'll come back to this page.</p>
      <Button variant="primary" onClick={() => signIn(client)}>
        Sign in
      </Button>
    </section>
  );
}

export function Shell() {
  const me = useMe();
  const ended = useSessionEnded();
  const main = useRef<HTMLElement>(null);
  const wasEnded = useRef(false);
  // Back from a sign-in in place: the notice that had focus is gone, so focus goes to the page's own heading (or,
  // while the page has none, to the page itself).
  useEffect(() => {
    if (wasEnded.current && !ended) {
      const heading = main.current?.querySelector<HTMLElement>('h1, h2');
      if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      (heading ?? main.current)?.focus();
    }
    wasEnded.current = ended;
  }, [ended]);
  const user = me.data?.user;
  const roles = me.data?.purview_roles ?? [];
  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        Skip to the page
      </a>
      <nav aria-label="Main" className={styles.nav}>
        <Link to="/matters" className={styles.brand}>
          <span aria-hidden="true" className={styles.mark} />
          <span>SearchTrail</span>
        </Link>
        <TenantCard me={me} />
        <div className={styles.links}>
          <NavLink to="/matters" className={styles.link}>
            Matters
          </NavLink>
        </div>
        {user && (
          <div className={styles.user}>
            <span aria-hidden="true" className={styles.avatar}>
              {user.initials}
            </span>
            <span className={styles.person}>
              <strong>{user.display_name}</strong>
              <span>{roles.length > 0 ? roles.join(', ') : 'No Purview role found'}</span>
            </span>
          </div>
        )}
      </nav>
      <main id="main" ref={main} tabIndex={-1} className={styles.main}>
        {ended && <SessionEnded />}
        <div className={styles.content} hidden={ended}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
