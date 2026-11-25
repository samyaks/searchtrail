// The header every matter screen shares: where you are, the matter's name and facts, the query version and
// preview state, and the tabs for its six screens. Matches the top of docs/design/Define.dc.html.
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { useMatter } from '@/api/queries';
import { ErrorNotice, Pill } from '@/components';
import styles from './MatterLayout.module.css';
import { matterChips, matterSubline } from './matterHeader';
import { MATTER_TABS } from './tabs';

export function MatterLayout() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);

  // A matter that can't be opened (it doesn't exist, or you may not open it, which looks the same) has no tabs.
  // A matter already open stays open when a later read fails (an ended session, say), so the screen keeps its state.
  if (matter.isError && matter.data === undefined) {
    return (
      <div className={styles.page}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link to="/matters">Matters</Link>
        </nav>
        <ErrorNotice error={matter.error} matterId={matterId} onRetry={() => void matter.refetch()} headingLevel={1} />
      </div>
    );
  }

  const data = matter.data;
  const chips = data && matterChips(data);
  return (
    <div className={styles.page}>
      <header className={styles.header} aria-busy={!data}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link to="/matters">Matters</Link>
          <span aria-hidden="true">/</span>
          <span className="st-mono">{data?.matter_number ?? '…'}</span>
        </nav>
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{data ? data.name.trim() || 'Untitled matter' : 'Loading…'}</h1>
            <p className={styles.subline}>{data ? matterSubline(data) : ' '}</p>
          </div>
          {chips && (
            <div className={styles.chips}>
              <Pill tone={chips.version.tone}>{chips.version.text}</Pill>
              <Pill tone={chips.preview.tone}>{chips.preview.text}</Pill>
            </div>
          )}
        </div>
        <nav aria-label="Matter sections" className={styles.tabs}>
          {MATTER_TABS.map((tab) => (
            <NavLink key={tab.path} to={tab.path} className={styles.tab}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
