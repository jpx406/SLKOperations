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
import { NptAnalysis, Statistics } from './pages/Statistics';
import { Competency, Utilization } from './pages/People';
import { Attendance } from './pages/Attendance';
import { Roster } from './pages/Roster';
import { Inventory } from './pages/Inventory';
import { PreJobNoteEditor, PreJobNotesList, PreJobNotesPrint } from './pages/PreJobNotes';
import { JraPage } from './pages/Jra';
import { JobReport } from './pages/JobReport';
import { BonusAnalysis, BonusReport, BonusRules } from './pages/Bonus';
import { SalesDashboard } from './pages/Sales';
import { WireDetail, WireKpis, WiresRegister } from './pages/Wires';
import { Reconciliation } from './pages/Reconciliation';
import { Schedule } from './pages/Schedule';
import { SignIn } from './pages/SignIn';
import { Stub } from './pages/Stub';
import './styles.css';

const BUILT = new Set(['/operation/schedule', '/operation/jobs', '/operation/job-log', '/operation/pre-job-notes', '/inventory/explosive', '/inventory/hardware', '/inventory/mcr', '/attendance', '/attendance/roster', '/quality/statistics', '/quality/npt', '/quality/utilization', '/quality/competency', '/quality/wire-kpis', '/wires', '/bonus/report', '/bonus/analysis', '/bonus/rules', '/sales', '/operation/8-min-facts', '/operation/failure-roster', '/operation/reconciliation', '/operation/database', '/admin/users']);

const router = createBrowserRouter([
  { path: '/signin', element: <SignIn /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/operation/schedule" replace /> },
      { path: 'operation/schedule', element: <Schedule /> },
      { path: 'operation/jobs', element: <JobBoard /> },
      { path: 'operation/jobs/:id/jra', element: <JraPage /> },
      { path: 'operation/jobs/:id/report', element: <JobReport /> },
      { path: 'operation/jobs/:id/:stage?', element: <JobEditor /> },
      { path: 'operation/pre-job-notes', element: <PreJobNotesList /> },
      { path: 'operation/pre-job-notes/print', element: <PreJobNotesPrint /> },
      { path: 'operation/pre-job-notes/:id', element: <PreJobNoteEditor /> },
      { path: 'operation/job-log', element: <JobLog /> },
      { path: 'operation/8-min-facts', element: <EightMinFactsList /> },
      { path: 'operation/8-min-facts/:id', element: <EightMinFactsEditor /> },
      { path: 'operation/failure-roster', element: <FailureRoster /> },
      { path: 'quality/statistics', element: <Statistics /> },
      { path: 'quality/npt', element: <NptAnalysis /> },
      { path: 'quality/utilization', element: <Utilization /> },
      { path: 'quality/competency', element: <Competency /> },
      { path: 'quality/wire-kpis', element: <WireKpis /> },
      { path: 'wires', element: <WiresRegister /> },
      { path: 'bonus/report', element: <BonusReport /> },
      { path: 'bonus/analysis', element: <BonusAnalysis /> },
      { path: 'bonus/rules', element: <BonusRules /> },
      { path: 'sales', element: <SalesDashboard /> },
      { path: 'wires/:serial', element: <WireDetail /> },
      { path: 'attendance', element: <Attendance /> },
      { path: 'attendance/roster', element: <Roster /> },
      { path: 'inventory/explosive', element: <Inventory key="explosive" inv="explosive" /> },
      { path: 'inventory/hardware', element: <Inventory key="hardware" inv="hardware" /> },
      { path: 'inventory/mcr', element: <Inventory key="mcr" inv="mcr" /> },
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
