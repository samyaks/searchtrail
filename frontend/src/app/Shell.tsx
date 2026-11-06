// The app shell: side navigation and the main area. WS-D builds it out to match docs/design/.
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet } from 'react-router';
import { api, unwrap } from '@/api/client';
import styles from './Shell.module.css';

export function Shell() {
  const me = useQuery({ queryKey: ['me'], queryFn: async () => unwrap(await api.GET('/me')) });
  return (
    <div className={styles.shell}>
      <nav aria-label="Main" className={styles.nav}>
        <Link to="/matters" className={styles.brand}>
          <span aria-hidden="true" className={styles.mark} />
          <span>SearchTrail</span>
        </Link>
        {me.data && (
          <div className={styles.tenant}>
            <span>{me.data.tenant.name}</span>
            <span>{me.data.dry_run ? 'Dry run (no tenant contacted)' : 'Microsoft 365 connected'}</span>
          </div>
        )}
        <div className={styles.links}>
          <NavLink to="/matters" className={styles.link}>
            Matters
          </NavLink>
        </div>
        {me.data && (
          <div className={styles.user}>
            <span aria-hidden="true" className={styles.avatar}>
              {me.data.user.initials}
            </span>
            <span>
              <strong>{me.data.user.display_name}</strong>
              <br />
              <span>{me.data.purview_roles.join(', ')}</span>
            </span>
          </div>
        )}
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
