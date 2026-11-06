// Routes for the seven screens. WS-D owns this file; screens live in src/screens/<name>/.
import { Navigate, type RouteObject } from 'react-router';
import { DefineScreen } from '@/screens/define/DefineScreen';
import { ExportScreen } from '@/screens/export/ExportScreen';
import { LogScreen } from '@/screens/log/LogScreen';
import { MattersScreen } from '@/screens/matters/MattersScreen';
import { PreviewScreen } from '@/screens/preview/PreviewScreen';
import { ScopeScreen } from '@/screens/scope/ScopeScreen';
import { TermsScreen } from '@/screens/terms/TermsScreen';
import { MatterLayout } from './MatterLayout';
import { Shell } from './Shell';

export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/matters" replace /> },
      { path: 'matters', element: <MattersScreen /> },
      {
        path: 'matters/:matterId',
        element: <MatterLayout />,
        children: [
          { index: true, element: <Navigate to="scope" replace /> },
          { path: 'define', element: <DefineScreen /> },
          { path: 'scope', element: <ScopeScreen /> },
          { path: 'preview', element: <PreviewScreen /> },
          { path: 'terms', element: <TermsScreen /> },
          { path: 'export', element: <ExportScreen /> },
          { path: 'log', element: <LogScreen /> },
        ],
      },
      { path: '*', element: <Navigate to="/matters" replace /> },
    ],
  },
];
