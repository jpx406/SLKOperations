import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router';
import { NAV } from '../shared/menus';
import { RequireAuth } from './auth';
import { AppShell } from './components/AppShell';
import { AdminUsers } from './pages/AdminUsers';
import { Database } from './pages/Database';
import { UtilityList, UtilityProject } from './pages/Utilities';
import { JobBoard } from './pages/JobBoard';
import { JobEditor } from './pages/JobEditor';
import { JobLog } from './pages/JobLog';
import { EightMinFactsEditor, EightMinFactsList } from './pages/EightMinFacts';
import { FailureRoster } from './pages/FailureRoster';
import { NptAnalysis, Statistics } from './pages/Statistics';
import { Utilization } from './pages/People';
import { CompetencyModule } from './pages/CompetencyModule';
import { Attendance } from './pages/Attendance';
import { Inventory } from './pages/Inventory';
import { PreJobNoteEditor, PreJobNotesList, PreJobNotesPrint } from './pages/PreJobNotes';
import { JraPage } from './pages/Jra';
import { JobLogPage, JobWinchPage } from './pages/JobSubPages';
import { JobReport } from './pages/JobReport';
import { Diagrams } from './pages/Diagrams';
import { BonusAnalysis, BonusReport, BonusRules } from './pages/Bonus';
import { SalesDashboard } from './pages/Sales';
import { AdminData } from './pages/AdminData';
import { FormTemplates } from './pages/FormTemplates';
import { AuditTrail } from './pages/AuditTrail';
import { AdminCompanies } from './pages/AdminCompanies';
import { AiAgent } from './pages/AiAgent';
import { KnowledgeHub } from './pages/Knowledge';
import { QuickPlan } from './pages/QuickPlan';
import { WireDetail, WireKpis, WiresRegister } from './pages/Wires';
import { Reconciliation } from './pages/Reconciliation';
import { Schedule } from './pages/Schedule';
import { SignIn } from './pages/SignIn';
import { ModulePicker } from './pages/Modules';
import { QrApprove } from './pages/QrApprove';
import { Stub } from './pages/Stub';
import { RouteError } from './components/RouteError';
import { lazyRetry, watchPreloadErrors } from './staleBuild';
import './styles.css';

// a page left open across a deploy reloads into the new version instead of failing (6z.48)
watchPreloadErrors();

// the winch analysis window (6z.41) opens on its own, without the app around it
const WinchWindow = lazy(lazyRetry(() => import('./pages/winch/WinchWindow')));

const BUILT = new Set(['/operation/schedule', '/operation/jobs', '/operation/job-log', '/operation/pre-job-notes', '/inventory/explosive', '/inventory/hardware', '/inventory/mcr', '/attendance', '/attendance/roster', '/quality/statistics', '/quality/npt', '/quality/utilization', '/competency', '/career', '/quality/competency', '/quality/wire-kpis', '/wires', '/bonus/report', '/bonus/analysis', '/bonus/rules', '/sales', '/operation/8-min-facts', '/operation/failure-roster', '/wires/reconciliation', '/operation/database', '/admin/users', '/admin/data', '/admin/form-templates', '/admin/audit', '/admin/companies', '/admin/ai-agent', '/knowledge', '/operation/quick-plan', '/utilities/rig-up', '/utilities/tool-string', '/utilities/winch']);

/** Sends an old address to the page's new one, keeping its filters (?severity=high ...). */
function MovedTo({ path }: { path: string }) {
  const loc = useLocation();
  return <Navigate to={`${path}${loc.search}${loc.hash}`} replace />;
}

const router = createBrowserRouter([
  { path: '/signin', element: <SignIn />, errorElement: <RouteError /> },
  // the phone side of QR sign-in: public, it signs another computer in after Face ID on this phone
  { path: '/qr/:id', element: <QrApprove /> },
  // after signing in: the SLK Operations Hub, the Knowledge Hub or Competency (6z.33)
  { path: '/modules', element: <RequireAuth><ModulePicker /></RequireAuth>, errorElement: <RouteError /> },
  { path: '/winch-window', element: <RequireAuth><Suspense fallback={null}><WinchWindow /></Suspense></RequireAuth>, errorElement: <RouteError /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/modules" replace /> },
      { path: 'operation/schedule', element: <Schedule /> },
      { path: 'operation/jobs', element: <JobBoard /> },
      { path: 'operation/jobs/:id/jra', element: <JraPage /> },
      // the Job log and the Winch data on pages of their own, like the JRA (6z.49)
      { path: 'operation/jobs/:id/log', element: <JobLogPage /> },
      { path: 'operation/jobs/:id/winch', element: <JobWinchPage /> },
      { path: 'operation/jobs/:id/report', element: <JobReport /> },
      { path: 'operation/jobs/:id/diagrams', element: <Diagrams /> },
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
      // the Competency Framework System, converted to slickline (6z.34)
      { path: 'competency', element: <CompetencyModule /> },
      { path: 'career', element: <CompetencyModule mode="career" /> },
      // the old address, from before Competency had its own menu (6z.35)
      { path: 'quality/competency', element: <MovedTo path="/competency" /> },
      { path: 'quality/wire-kpis', element: <WireKpis /> },
      { path: 'wires', element: <WiresRegister /> },
      { path: 'bonus/report', element: <BonusReport /> },
      { path: 'bonus/analysis', element: <BonusAnalysis /> },
      { path: 'bonus/rules', element: <BonusRules /> },
      { path: 'sales', element: <SalesDashboard /> },
      { path: 'wires/:serial', element: <WireDetail /> },
      { path: 'attendance', element: <Attendance /> },
      // the Headcount Roster is now Users & Roles (people) and its Attendance categories tab
      { path: 'attendance/roster', element: <Navigate to="/admin/users" replace /> },
      { path: 'inventory/explosive', element: <Inventory key="explosive" inv="explosive" /> },
      { path: 'inventory/hardware', element: <Inventory key="hardware" inv="hardware" /> },
      { path: 'inventory/mcr', element: <Inventory key="mcr" inv="mcr" /> },
      { path: 'wires/reconciliation', element: <Reconciliation /> },
      // the old address, kept for bookmarks and digest emails sent before the move
      { path: 'operation/reconciliation', element: <MovedTo path="/wires/reconciliation" /> },
      { path: 'operation/database', element: <Database /> },
      // Utilities (6z.47): the tools on their own, as projects
      { path: 'utilities/:slug', element: <UtilityList /> },
      { path: 'utilities/:slug/:id', element: <UtilityProject /> },
      { path: 'admin/users', element: <AdminUsers /> },
      { path: 'admin/data', element: <AdminData /> },
      { path: 'admin/form-templates', element: <FormTemplates /> },
      { path: 'admin/audit', element: <AuditTrail /> },
      { path: 'admin/companies', element: <AdminCompanies /> },
      { path: 'admin/ai-agent', element: <AiAgent /> },
      { path: 'knowledge', element: <KnowledgeHub /> },
      { path: 'operation/quick-plan', element: <QuickPlan /> },
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
