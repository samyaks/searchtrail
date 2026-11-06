// Matter header and tabs around the six matter screens. WS-D builds it out to match docs/design/.
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { useMatter } from '@/api/queries';
import { MATTER_TABS } from './tabs';

export function MatterLayout() {
  const { matterId = '' } = useParams();
  const matter = useMatter(matterId);
  return (
    <div>
      <nav aria-label="Breadcrumb">
        <Link to="/matters">Matters</Link> / <span className="st-mono">{matter.data?.matter_number ?? matterId}</span>
      </nav>
      <h1>{matter.data?.name ?? (matter.isError ? 'Matter not found' : 'Loading…')}</h1>
      <nav aria-label="Matter sections" style={{ display: 'flex', gap: 16, margin: '16px 0' }}>
        {MATTER_TABS.map((tab) => (
          <NavLink key={tab.path} to={tab.path}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
