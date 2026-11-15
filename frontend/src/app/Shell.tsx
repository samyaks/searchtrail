// The app shell: side navigation (the tenant, the way in to Matters, the person) and the main area.
// Matches docs/design/Main.dc.html, except that it shows only what V1 has: the design's Connections,
// Team and roles, and Help links, and the licence line, have no page or no data behind them yet.
import { Link, NavLink, Outlet } from 'react-router';
import type { Schemas } from '@/api/client';
import { useMe } from '@/api/queries';
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

export function Shell() {
  const me = useMe();
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
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
