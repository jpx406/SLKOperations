import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { NAV } from '../shared/menus';
import { RequireAuth } from './auth';
import { AppShell } from './components/AppShell';
import { AdminUsers } from './pages/AdminUsers';
import { Database } from './pages/Database';
import { JobBoard } from './pages/JobBoard';
import { JobEditor } from './pages/JobEditor';
import { JobLog } from './pages/JobLog';
import { EightMinFactsEditor, EightMinFactsList } from './pages/EightMinFacts';
import { FailureRoster } from './pages/FailureRoster';
import { Reconciliation } from './pages/Reconciliation';
import { Schedule } from './pages/Schedule';
import { SignIn } from './pages/SignIn';
import { Stub } from './pages/Stub';
import './styles.css';

const BUILT = new Set(['/operation/schedule', '/operation/jobs', '/operation/job-log', '/operation/8-min-facts', '/operation/failure-roster', '/operation/reconciliation', '/operation/database', '/admin/users']);

const router = createBrowserRouter([
  { path: '/signin', element: <SignIn /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/operation/schedule" replace /> },
      { path: 'operation/schedule', element: <Schedule /> },
      { path: 'operation/jobs', element: <JobBoard /> },
      { path: 'operation/jobs/:id/:stage?', element: <JobEditor /> },
      { path: 'operation/job-log', element: <JobLog /> },
      { path: 'operation/8-min-facts', element: <EightMinFactsList /> },
      { path: 'operation/8-min-facts/:id', element: <EightMinFactsEditor /> },
      { path: 'operation/failure-roster', element: <FailureRoster /> },
      { path: 'operation/reconciliation', element: <Reconciliation /> },
      { path: 'operation/database', element: <Database /> },
      { path: 'admin/users', element: <AdminUsers /> },
      ...NAV.flatMap((g) => g.pages).filter((p) => !BUILT.has(p.path)).map((p) => ({ path: p.path.slice(1), element: <Stub /> })),
      { path: '*', element: <Stub /> },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
